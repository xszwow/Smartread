const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("SmartReadDesktop", {
  platform: process.platform,
  appMode: "desktop",
  recognizeSpeech: (options = {}) => ipcRenderer.invoke("smartread:speech-recognize", options),
  cancelSpeechRecognition: () => ipcRenderer.invoke("smartread:speech-recognize-cancel")
});
