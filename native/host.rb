#!/usr/bin/ruby

require 'base64'
require 'fileutils'
require 'json'
require 'open3'
require 'securerandom'

HOST_VERSION = '1.1.2'
MAX_MESSAGE_BYTES = 64 * 1024 * 1024
APP_DIRECTORY = ENV.fetch(
  'SP2O_CONFIG_DIR',
  File.join(Dir.home, 'Library', 'Application Support', 'Social Post to Obsidian')
)
CONFIG_PATH = File.join(APP_DIRECTORY, 'config.json')

def read_message
  header = STDIN.read(4)
  return nil if header.nil? || header.empty?
  raise 'Invalid native message header' unless header.bytesize == 4

  length = header.unpack1('L<')
  raise 'Native message is too large' if length > MAX_MESSAGE_BYTES

  payload = STDIN.read(length)
  raise 'Native message ended early' unless payload&.bytesize == length

  JSON.parse(payload)
end

def write_message(message)
  payload = JSON.generate(message).encode('UTF-8')
  STDOUT.write([payload.bytesize].pack('L<'))
  STDOUT.write(payload)
  STDOUT.flush
end

def load_config
  return {} unless File.file?(CONFIG_PATH)

  JSON.parse(File.read(CONFIG_PATH, encoding: 'UTF-8'))
rescue JSON::ParserError
  {}
end

def save_config(config)
  FileUtils.mkdir_p(APP_DIRECTORY)
  temporary = "#{CONFIG_PATH}.tmp-#{Process.pid}-#{SecureRandom.hex(4)}"
  File.write(temporary, JSON.pretty_generate(config), mode: 'w', encoding: 'UTF-8')
  File.chmod(0o600, temporary)
  File.rename(temporary, CONFIG_PATH)
ensure
  File.delete(temporary) if defined?(temporary) && File.exist?(temporary)
end

def validate_vault(path)
  expanded = File.expand_path(path.to_s)
  raise 'Vault folder does not exist' unless File.directory?(expanded)
  raise 'Selected folder is not an Obsidian Vault' unless File.directory?(File.join(expanded, '.obsidian'))
  raise 'Vault folder is not writable' unless File.writable?(expanded)

  File.realpath(expanded)
end

def configured_vault
  path = load_config['vaultPath']
  raise 'Vault is not configured' if path.nil? || path.empty?

  validate_vault(path)
end

def safe_parts(relative_path)
  path = relative_path.to_s
  parts = path.split('/').reject(&:empty?)
  if path.start_with?('/') || parts.empty? || parts.any? { |part| part == '.' || part == '..' || part.include?("\0") }
    raise 'Invalid Vault path'
  end
  parts
end

def resolve_target(root, relative_path, create_directories: false)
  parts = safe_parts(relative_path)
  filename = parts.pop
  current = root

  parts.each do |part|
    current = File.join(current, part)
    raise 'Symbolic links are not allowed in Vault paths' if File.symlink?(current)
    if File.exist?(current)
      raise 'Vault path component is not a folder' unless File.directory?(current)
    elsif create_directories
      Dir.mkdir(current)
    else
      return nil
    end
  end

  target = File.join(current, filename)
  raise 'Symbolic links are not allowed in Vault paths' if File.symlink?(target)
  target
end

def resolve_directory(root, relative_path)
  current = root
  safe_parts(relative_path).each do |part|
    current = File.join(current, part)
    raise 'Symbolic links are not allowed in Vault paths' if File.symlink?(current)
    return nil unless File.exist?(current)
    raise 'Vault path component is not a folder' unless File.directory?(current)
  end
  current
end

def atomic_write(path, bytes)
  FileUtils.mkdir_p(File.dirname(path))
  temporary = "#{path}.sp2o-tmp-#{Process.pid}-#{SecureRandom.hex(4)}"
  File.open(temporary, 'wb') do |file|
    file.write(bytes)
    file.flush
    file.fsync
  end
  File.rename(temporary, path)
ensure
  File.delete(temporary) if defined?(temporary) && File.exist?(temporary)
end

def choose_vault
  script = 'POSIX path of (choose folder with prompt "Select your Obsidian Vault")'
  output, error, status = Open3.capture3('/usr/bin/osascript', '-e', script)
  raise(error.strip.empty? ? 'Vault selection was cancelled' : error.strip) unless status.success?

  validate_vault(output.strip)
end

def icloud_drive_path?(path)
  mobile_documents = File.join(Dir.home, 'Library', 'Mobile Documents')
  expanded = File.expand_path(path)
  expanded == mobile_documents || expanded.start_with?(mobile_documents + File::SEPARATOR)
end

def move_to_trash(path)
  script = <<~APPLESCRIPT
    on run argv
      set targetFile to POSIX file (item 1 of argv) as alias
      tell application "Finder" to delete targetFile
    end run
  APPLESCRIPT
  _output, error, status = Open3.capture3('/usr/bin/osascript', '-e', script, path)
  return if status.success? && !File.exist?(path)

  detail = error.strip
  if detail.include?('-1743')
    raise 'macOS 拒絕 Finder 自動化；請到「系統設定 > 隱私權與安全性 > 自動化」允許 Google Chrome 控制 Finder。'
  end
  raise(detail.empty? ? 'Finder could not move the Vault file to Trash' : detail)
end

def remove_file(path)
  # Chrome-launched native hosts can be denied unlink access to iCloud Drive.
  if icloud_drive_path?(path)
    move_to_trash(path)
  else
    File.delete(path)
  end
rescue Errno::EPERM
  move_to_trash(path)
end

def host_status
  path = load_config['vaultPath']
  return { 'ok' => true, 'configured' => false, 'version' => HOST_VERSION } if path.nil? || path.empty?

  vault = validate_vault(path)
  {
    'ok' => true,
    'configured' => true,
    'version' => HOST_VERSION,
    'vaultName' => File.basename(vault)
  }
rescue StandardError => error
  {
    'ok' => false,
    'configured' => true,
    'version' => HOST_VERSION,
    'error' => error.message
  }
end

def handle_message(message)
  case message['action']
  when 'ping'
    host_status
  when 'chooseVault'
    vault = choose_vault
    save_config('vaultPath' => vault)
    { 'ok' => true, 'configured' => true, 'version' => HOST_VERSION, 'vaultName' => File.basename(vault) }
  when 'configure'
    vault = validate_vault(message['vaultPath'])
    save_config('vaultPath' => vault)
    { 'ok' => true, 'configured' => true, 'version' => HOST_VERSION, 'vaultName' => File.basename(vault) }
  when 'write'
    vault = configured_vault
    target = resolve_target(vault, message['path'], create_directories: true)
    bytes = if message['encoding'] == 'base64'
              Base64.strict_decode64(message.fetch('data'))
            else
              message.fetch('data').to_s.encode('UTF-8')
            end
    atomic_write(target, bytes)
    { 'ok' => true }
  when 'remove'
    vault = configured_vault
    target = resolve_target(vault, message['path'])
    remove_file(target) if target && File.file?(target)
    { 'ok' => true }
  when 'exists'
    vault = configured_vault
    target = resolve_target(vault, message['path'])
    { 'ok' => true, 'exists' => !target.nil? && File.file?(target) }
  when 'cleanEmptyMediaFolders'
    vault = configured_vault
    media_root = resolve_directory(vault, message.fetch('path'))
    removed = 0
    if media_root && File.directory?(media_root)
      Dir.each_child(media_root) do |name|
        next unless name.match?(/^\d{4}-\d{2}-\d{2}_\d{4}_.+/)

        directory = File.join(media_root, name)
        next if File.symlink?(directory) || !File.directory?(directory) || !Dir.empty?(directory)

        Dir.rmdir(directory)
        removed += 1
      rescue Errno::ENOENT, Errno::ENOTEMPTY
        next
      end
    end
    { 'ok' => true, 'removed' => removed }
  else
    raise 'Unknown native host action'
  end
end

while (message = read_message)
  begin
    response = handle_message(message)
    write_message(response)
  rescue StandardError => error
    write_message('ok' => false, 'error' => error.message, 'version' => HOST_VERSION)
  end
end
