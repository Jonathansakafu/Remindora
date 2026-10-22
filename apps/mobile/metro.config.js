// Expo's default Metro config detects the npm-workspaces monorepo automatically.
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname);
