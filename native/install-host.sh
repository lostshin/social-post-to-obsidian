#!/bin/zsh

set -euo pipefail

script_dir="${0:A:h}"
project_dir="${script_dir:h}"
extension_id="${1:-}"

if [[ -z "${extension_id}" ]]; then
  extension_id="$(/usr/bin/ruby -rdigest -e '
    digest = Digest::SHA256.hexdigest(File.expand_path(ARGV.fetch(0)))[0, 32]
    puts digest.tr("0-9a-f", "a-p")
  ' "${project_dir}")"
fi

if [[ ! "${extension_id}" =~ '^[a-p]{32}$' ]]; then
  print -u2 "Invalid Chrome extension ID: ${extension_id}"
  exit 1
fi

app_dir="${HOME}/Library/Application Support/Social Post to Obsidian"
manifest_dir="${HOME}/Library/Application Support/Google/Chrome/NativeMessagingHosts"
host_path="${app_dir}/host.rb"
manifest_path="${manifest_dir}/com.lostshin.social_post_to_obsidian.json"

/bin/mkdir -p "${app_dir}" "${manifest_dir}"
/usr/bin/install -m 755 "${script_dir}/host.rb" "${host_path}"

/usr/bin/ruby -rjson -e '
  manifest_path, host_path, extension_id = ARGV
  manifest = {
    name: "com.lostshin.social_post_to_obsidian",
    description: "Local Vault writer for Social Post to Obsidian",
    path: host_path,
    type: "stdio",
    allowed_origins: ["chrome-extension://#{extension_id}/"]
  }
  File.write(manifest_path, JSON.pretty_generate(manifest) + "\n")
' "${manifest_path}" "${host_path}" "${extension_id}"

print "Installed native host for extension ${extension_id}\n"
print "Manifest: ${manifest_path}\n"
print "Reload the extension in chrome://extensions before testing.\n"
