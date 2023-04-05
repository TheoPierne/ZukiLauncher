const fs = require('fs');
const path = require('path');

const ConfigManager = require('./configmanager');

/**
 * Generate skin file
 * @param  {[type]}  playerdata An object to represent a player.
 * @param  {[type]}  file The file that contain the skin to upload
 * @param  {Boolean} isSlim Set the skin on slim or classic
 * @return {Promise<Boolean>}
 */
exports.generateSkinFile = async (playerdata, file, isSlim = false) => {

	try {
		await exports.checkApiStatus();
	} catch(e) {
		return false;
	}

	const name = playerdata.displayName ?? playerdata.username;

	const data = new FormData();
	data.append("file", file);
	data.append("variant", isSlim ? "slim" : "classic");
	data.append("name", name);

	const res = await fetch('https://api.mineskin.org/generate/upload', {
		method: 'POST',
		body: data
	});

	if (res.ok) {
		const json = await res.json();
		console.log(json);
		const signature = json.data.texture.signature;
		const value = json.data.texture.value;
		if (signature && value) {
			const skinPath = path.join(ConfigManager.getLauncherDirectory(), 'skin');

			if (!fs.existsSync(skinPath)) {
				fs.mkdirSync(skinPath);
			}

			const skinFullPath = path.join(skinPath, `${name}.skin`);
			fs.writeFileSync(skinFullPath, `${value}\n${signature}\n4102444800000`);

			const url = json.data.texture.url;
			ConfigManager.updateSkin(playerdata.uuid, { path: skinFullPath, url, variant: isSlim ? "slim" : "classic" });
			ConfigManager.save();
			return true;
		}
	}
	return false;
}

exports.checkApiStatus = async () => {
	const res = await fetch('https://api.mineskin.org/get/delay');
	return res.ok;
}
