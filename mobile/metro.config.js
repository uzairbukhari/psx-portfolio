const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const config = getDefaultConfig(__dirname);
// The pure calculation modules live in ../lib and are shared with the web app.
config.watchFolders = [path.resolve(__dirname, '../lib')];
// Shared modules in ../lib import @noble/*; resolve those from the app's own node_modules (the root one is absent
// on EAS and CI builds).
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')];
module.exports = config;
