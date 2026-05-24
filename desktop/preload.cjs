const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("SmartReadDesktop", {
  platform: process.platform,
  appMode: "desktop",
  onNativeZoomRequested: (callback) => {
    const listener = (_event, direction) => callback(direction);
    ipcRenderer.on("smartread:native-zoom-requested", listener);
    return () => ipcRenderer.removeListener("smartread:native-zoom-requested", listener);
  },
  setPdfZoomRoutingEnabled: (enabled) => ipcRenderer.send("smartread:set-pdf-zoom-routing", enabled === true),
  recognizeSpeech: (options = {}) => ipcRenderer.invoke("smartread:speech-recognize", options),
  cancelSpeechRecognition: () => ipcRenderer.invoke("smartread:speech-recognize-cancel")
});
