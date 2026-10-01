const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const config = getDefaultConfig(__dirname);
// The pure calculation modules live in ../lib and are shared with the web app.
config.watchFolders = [path.resolve(__dirname, '../lib')];
module.exports = config;
