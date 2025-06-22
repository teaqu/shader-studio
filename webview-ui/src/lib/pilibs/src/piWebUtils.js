//==============================================================================
//
// piWebUtils
//
//==============================================================================

// performance.now polyfill
function getRealTime() {
    if ("performance" in window) return window.performance.now();
    return (new Date()).getTime();
}

function htmlEntities(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function piDisableTouch() {
    document.body.addEventListener('touchstart', function (e) { e.preventDefault(); });
}

function piGetTime(timestamp) {
    const monthstr = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    let a = new Date(timestamp * 1000);
    return a.getFullYear() + "-" + monthstr[a.getMonth()] + "-" + a.getDate();
}

function piGetCoords(obj) {
    var x = 0;
    var y = 0;
    do {
        x += obj.offsetLeft;
        y += obj.offsetTop;
    } while (obj = obj.offsetParent);
    return { mX: x, mY: y };
}

function piGetMouseCoords(ev, canvasElement) {
    var pos = piGetCoords(canvasElement);
    var mcx = (ev.pageX - pos.mX) * canvasElement.width / canvasElement.offsetWidth;
    var mcy = canvasElement.height - (ev.pageY - pos.mY) * canvasElement.height / canvasElement.offsetHeight;
    return { mX: mcx, mY: mcy };
}

function piGetSourceElement(e) {
    var ele = null;
    if (e.target) ele = e.target;
    if (e.srcElement) ele = e.srcElement;
    return ele;
}

function piRequestFullScreen(ele) {
    if (ele === null) ele = document.documentElement;
    if (ele.requestFullscreen) ele.requestFullscreen();
    else if (ele.msRequestFullscreen) ele.msRequestFullscreen();
    else if (ele.mozRequestFullScreen) ele.mozRequestFullScreen();
    else if (ele.webkitRequestFullscreen) ele.webkitRequestFullscreen(Element.ALLOW_KEYBOARD_INPUT);
}

function piIsFullScreen() {
    return document.fullscreen || document.mozFullScreen || document.webkitIsFullScreen || document.msFullscreenElement || false;
}

function piExitFullScreen() {
    if (document.exitFullscreen) document.exitFullscreen();
    else if (document.msExitFullscreen) document.msExitFullscreen();
    else if (document.mozCancelFullScreen) document.mozCancelFullScreen();
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
}

function piCreateGlContext(cv, useAlpha, useDepth, usePreserveBuffer, useSupersampling) {
    var opts = { alpha: useAlpha, depth: useDepth, stencil: false, premultipliedAlpha: false, antialias: useSupersampling, preserveDrawingBuffer: usePreserveBuffer, powerPreference: "high-performance" };
    var gl = null;
    if (gl === null) gl = cv.getContext("webgl2", opts);
    if (gl === null) gl = cv.getContext("experimental-webgl2", opts);
    if (gl === null) gl = cv.getContext("webgl", opts);
    if (gl === null) gl = cv.getContext("experimental-webgl", opts);
    return gl;
}

function piCreateAudioContext() {
    var res = null;
    try {
        if (window.AudioContext) res = new AudioContext();
        if (res === null && window.webkitAudioContext) res = new webkitAudioContext();
    }
    catch (e) {
        res = null;
    }
    return res;
}

function piHexColorToRGB(str) {
    var rgb = parseInt(str.slice(1), 16);
    var r = (rgb >> 16) & 255;
    var g = (rgb >> 8) & 255;
    var b = (rgb >> 0) & 255;
    return [r, g, b];
}

function piCreateFPSCounter() {
    var mFrame;
    var mTo;
    var mFPS;
    var iReset = function (time) {
        mFrame = 0;
        mTo = time;
        mFPS = 60.0;
    };
    var iCount = function (time) {
        mFrame++;
        if ((time - mTo) > 500.0) {
            mFPS = 1000.0 * mFrame / (time - mTo);
            mFrame = 0;
            mTo = time;
            return true;
        }
        return false;
    };
    var iGetFPS = function () {
        return mFPS;
    };
    return { Reset: iReset, Count: iCount, GetFPS: iGetFPS };
}

function piCanMediaRecorded(canvas) {
    if (typeof window.MediaRecorder !== 'function' || typeof canvas.captureStream !== 'function') {
        return false;
    }
    return true;
}

function piCreateMediaRecorder(isRecordingCallback, canvas) {
    if (piCanMediaRecorded(canvas) == false) {
        return null;
    }
    var mediaRecorder = new MediaRecorder(canvas.captureStream());
    var chunks = [];
    mediaRecorder.ondataavailable = function (e) {
        if (e.data.size > 0) {
            chunks.push(e.data);
        }
    };
    mediaRecorder.onstart = function () {
        isRecordingCallback(true);
    };
    mediaRecorder.onstop = function () {
        isRecordingCallback(false);
        let blob = new Blob(chunks, { type: "video/webm" });
        chunks = [];
        let url = window.URL.createObjectURL(blob);
        let a = document.createElement("a");
        document.body.appendChild(a);
        a.style = "display: none";
        a.href = url;
        a.download = "capture.webm";
        a.click();
        window.URL.revokeObjectURL(url);
    };
    return mediaRecorder;
}

function piTriggerDownload(name, blob) {
    let url = URL.createObjectURL(blob);
    let aElement = document.createElement("a");
    aElement.href = url;
    aElement.target = "_self";
    aElement.download = name;
    document.body.appendChild(aElement);
    aElement.click();
    document.body.removeChild(aElement);
}

export {
    getRealTime,
    htmlEntities,
    piDisableTouch,
    piGetTime,
    piGetCoords,
    piGetMouseCoords,
    piGetSourceElement,
    piRequestFullScreen,
    piIsFullScreen,
    piExitFullScreen,
    piCreateGlContext,
    piCreateAudioContext,
    piHexColorToRGB,
    piCreateFPSCounter,
    piCanMediaRecorded,
    piCreateMediaRecorder,
    piTriggerDownload
};