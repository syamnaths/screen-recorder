const toggleRecordingBtn = document.getElementById('toggleRecording');
const recordingList = document.getElementById('recordingList');
const facecamToggle = document.getElementById('facecamToggle');

let isRecording = false;
let mediaRecorder;
let stream;
let recordedChunks = [];
let writableStream = null;
let facecamStream = null;
let facecamVideo = null;

const RECORDING_STORAGE_KEY = 'screenRecordings';

// Load recordings from localStorage on page load
window.addEventListener('load', () => {
    loadRecordings();
});

toggleRecordingBtn.addEventListener('click', () => {
    if (isRecording) {
        stopRecording();
    } else {
        startRecording();
    }
});

function loadRecordings() {
    const recordings = JSON.parse(localStorage.getItem(RECORDING_STORAGE_KEY)) || [];
    recordingList.innerHTML = '';
    if (recordings.length === 0) {
        recordingList.innerHTML = '<li>No recordings yet.</li>';
        return;
    }
    recordings.forEach(rec => {
        const li = document.createElement('li');
        const nameSpan = document.createElement('span');
        nameSpan.textContent = rec.name;
        const dateSpan = document.createElement('span');
        dateSpan.className = 'date';
        dateSpan.textContent = rec.date;
        li.appendChild(nameSpan);
        li.appendChild(dateSpan);
        recordingList.appendChild(li);
    });
}

function saveRecordingToList(fileName) {
    const recordings = JSON.parse(localStorage.getItem(RECORDING_STORAGE_KEY)) || [];
    const newRecording = {
        name: fileName,
        date: new Date().toLocaleString()
    };
    recordings.unshift(newRecording); // Add to the beginning
    localStorage.setItem(RECORDING_STORAGE_KEY, JSON.stringify(recordings));
    loadRecordings();
}

async function startRecording() {
    let audioStream;
    let fileHandle;
    let pipWindow = null;

    try {
        // 1. Initialize Facecam PiP Window immediately (requires user gesture)
        if (facecamToggle.checked && 'documentPictureInPicture' in window) {
            try {
                pipWindow = await window.documentPictureInPicture.requestWindow({
                    width: 170,
                    height: 170,
                });

                // Copy styles/stylesheets to the PiP window
                [...document.styleSheets].forEach((styleSheet) => {
                    try {
                        const cssRules = [...styleSheet.cssRules].map((rule) => rule.cssText).join('');
                        const style = document.createElement('style');
                        style.textContent = cssRules;
                        pipWindow.document.head.appendChild(style);
                    } catch (e) {
                        const link = document.createElement('link');
                        link.rel = 'stylesheet';
                        link.type = styleSheet.type;
                        link.media = styleSheet.media;
                        link.href = styleSheet.href;
                        pipWindow.document.head.appendChild(link);
                    }
                });

                // Initial styling for the PiP window body
                pipWindow.document.body.style.backgroundColor = 'transparent'; // Or match theme
                pipWindow.document.body.style.display = 'flex';
                pipWindow.document.body.style.justifyContent = 'center';
                pipWindow.document.body.style.alignItems = 'center';
                pipWindow.document.body.style.margin = '0';

                // Track it globally to close later
                window.currentPiPWindow = pipWindow;

            } catch (err) {
                console.warn("Failed to open Document PiP window:", err);
            }
        }

        // 2. Get Audio/Video permissions
        if (facecamToggle.checked) {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
                audioStream = new MediaStream(stream.getAudioTracks());
                facecamStream = new MediaStream(stream.getVideoTracks());
            } catch (err) {
                console.warn("Could not get camera and microphone. Recording without them.", err);
                if (pipWindow) {
                    pipWindow.close();
                    window.currentPiPWindow = null;
                    pipWindow = null;
                }
            }
        } else {
            try {
                audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            } catch (err) {
                console.warn("Could not get microphone audio. Recording without audio.", err);
            }
        }

        // 3. Get the output file handle before showing the screen picker
        if ('showSaveFilePicker' in window) {
            fileHandle = await getOutputFileHandle();
            if (!fileHandle) {
                // User cancelled the file picker
                if (audioStream) audioStream.getTracks().forEach(track => track.stop());
                if (facecamStream) facecamStream.getTracks().forEach(track => track.stop());
                if (pipWindow) {
                    pipWindow.close();
                    window.currentPiPWindow = null;
                }
                return;
            }
        }

        // 4. Get Video stream
        let videoStream;
        try {
            videoStream = await navigator.mediaDevices.getDisplayMedia({
                video: true
            });
        } catch (err) {
            if (audioStream) audioStream.getTracks().forEach(track => track.stop());
            if (facecamStream) facecamStream.getTracks().forEach(track => track.stop());
            if (pipWindow) {
                pipWindow.close();
                window.currentPiPWindow = null;
            }
            throw err;
        }

        // Handle "Stop sharing"
        const videoTrack = videoStream.getVideoTracks()[0];
        videoTrack.onended = () => {
            stopRecording();
        };

        const tracks = [...videoStream.getTracks()];
        if (audioStream) {
            tracks.push(...audioStream.getAudioTracks());
        }

        stream = new MediaStream(tracks);

        // If facecam is enabled, create and add the video element
        if (facecamStream) {
            facecamVideo = document.createElement('video');
            facecamVideo.id = 'facecamVideo';
            facecamVideo.srcObject = facecamStream;
            facecamVideo.autoplay = true;
            facecamVideo.playsInline = true;
            facecamVideo.muted = true;

            if (pipWindow) {
                // Style for PiP
                facecamVideo.style.position = 'static';
                facecamVideo.style.width = '100%';
                facecamVideo.style.height = '100%';
                facecamVideo.style.maxWidth = '100vw';
                facecamVideo.style.maxHeight = '100vh';
                facecamVideo.style.borderRadius = '0'; // Let the window shape dictate, or keep 50% if user wants circle inside square window? 
                // User asked for style maintenance. The style puts a border and radius.
                // Let's keep the class/ID styles but override positioning.
                // However, ID #facecamVideo has fixed position. We need to override it.
                facecamVideo.style.position = 'static';

                // IMPORTANT: The user mentioned "maintain the thumbnail size". 
                // If we make the window small (170x170), filling it should be good.
                // But the CSS has specific width/height: 150px.
                // Let's just append it.

                pipWindow.document.body.appendChild(facecamVideo);

                // Facecam video ID styles might conflict if we copied stylesheets.
                // #facecamVideo { position: fixed ... }
                // We must override this on the element itself or injection.
                facecamVideo.style.setProperty('position', 'static', 'important');
                facecamVideo.style.setProperty('width', '100%', 'important');
                facecamVideo.style.setProperty('height', '100%', 'important');
                facecamVideo.style.setProperty('border-radius', '0', 'important'); // Make it fill window? Or keep circle?
                // User said "style missing... maintain the thumbnail size".
                // Existing style: width 150px, height 150px, border-radius 50%, border 3px solid blue.
                // If we put this in a 170x170 window:
                // If we want it to look like the circle, we should probably keep border-radius 0 on the VIDEO and let the user just see the video content, OR keep the circle style and have transparent background in window.
                // Let's try to match the circle look.
                facecamVideo.style.setProperty('width', '100%', 'important');
                facecamVideo.style.setProperty('height', '100%', 'important');
                facecamVideo.style.setProperty('border-radius', '0', 'important');
                facecamVideo.style.setProperty('border', 'none', 'important');

                // Actually, for "Picture in Picture", usually you just want the video rect.
                // But the user specifically mentioned "style missing".
                // Let's give it the blue border at least.
                facecamVideo.style.setProperty('border', '3px solid #007aff', 'important');


            } else {
                facecamVideo.style.top = `${window.innerHeight - 170}px`;
                facecamVideo.style.left = `${window.innerWidth - 170}px`;
                document.body.appendChild(facecamVideo);
                makeDraggable(facecamVideo);
            }
        }

        // Show recording indicator if sharing the current tab
        const videoTrackSettings = stream.getVideoTracks()[0].getSettings();
        if (videoTrackSettings.displaySurface === 'browser') {
            const indicator = document.createElement('div');
            indicator.id = 'recording-indicator';
            indicator.className = 'recording-indicator';
            document.body.appendChild(indicator);
        }

        console.log("Audio Tracks: ", stream.getAudioTracks());
        if (stream.getAudioTracks().length === 0) {
            console.warn("No audio track was found. Audio will not be recorded.");
        }

        // Countdown before final confirmation/start
        await runCountdown(5);

        if (fileHandle) {
            await startRecordingWithFileSystemAccess(fileHandle);
        } else {
            // Fallback for other browsers (Firefox/Safari)
            startRecordingWithFallback();
        }

    } catch (err) {
        console.error("Error starting recording: ", err);
        // Handle cases where user denies screen/audio permission or other errors
        if (audioStream) audioStream.getTracks().forEach(track => track.stop());
        if (facecamStream) facecamStream.getTracks().forEach(track => track.stop());
        if (stream) stream.getTracks().forEach(track => track.stop());
    }
}

async function getOutputFileHandle() {
    try {
        const suggestedName = `recording-${new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-')}.webm`;
        const fileHandle = await window.showSaveFilePicker({
            suggestedName,
            types: [{
                description: 'WebM Video File',
                accept: { 'video/webm': ['.webm'] },
            }],
        });
        return fileHandle;
    } catch (err) {
        // Handle user cancellation of the file picker
        console.log("User cancelled the file picker.");
        return null;
    }
}

async function startRecordingWithFileSystemAccess(fileHandle) {
    try {
        writableStream = await fileHandle.createWritable();
        mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });

        mediaRecorder.ondataavailable = async (event) => {
            if (event.data.size > 0 && writableStream) {
                await writableStream.write(event.data);
            }
        };

        mediaRecorder.onstop = async () => {
            if (writableStream) {
                await writableStream.close();
                writableStream = null;
            }
            saveRecordingToList(fileHandle.name);
        };

        mediaRecorder.start(1000); // Slice into 1s chunks
        isRecording = true;
        toggleRecordingBtn.textContent = 'Stop Recording';
        toggleRecordingBtn.classList.add('recording');

    } catch (err) {
        console.error("File System Access API error: ", err);
        alert("File System Access API error: ", err)
        // Stop the stream if user cancels the save dialog
        stream.getTracks().forEach(track => track.stop());
    }
}

function startRecordingWithFallback() {
    recordedChunks = [];
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });

    mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
            recordedChunks.push(event.data);
        }
    };

    mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const fileName = `recording-${new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-')}.webm`;
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        URL.revokeObjectURL(url);
        document.body.removeChild(a);
        saveRecordingToList(fileName);
    };

    mediaRecorder.start(1000);
    isRecording = true;
    toggleRecordingBtn.textContent = 'Stop Recording';
    toggleRecordingBtn.classList.add('recording');
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
    }
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
    }

    // Stop facecam stream and remove video element
    if (facecamStream) {
        facecamStream.getTracks().forEach(track => track.stop());
        facecamStream = null;
    }
    if (facecamVideo) {
        facecamVideo.remove();
        facecamVideo = null;
    }

    // Close PiP window
    if (window.currentPiPWindow) {
        window.currentPiPWindow.close();
        window.currentPiPWindow = null;
    }

    // Remove recording indicator
    const indicator = document.getElementById('recording-indicator');
    if (indicator) {
        indicator.remove();
    }

    isRecording = false;
    toggleRecordingBtn.textContent = 'Record Screen';
    toggleRecordingBtn.classList.remove('recording');
    stream = null;
    mediaRecorder = null;
}

function makeDraggable(element) {
    let isDragging = false;
    let offsetX, offsetY;

    element.addEventListener('mousedown', (e) => {
        isDragging = true;
        offsetX = e.clientX - element.getBoundingClientRect().left;
        offsetY = e.clientY - element.getBoundingClientRect().top;
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;

        let newX = e.clientX - offsetX;
        let newY = e.clientY - offsetY;

        // Constrain to viewport
        newX = Math.max(0, Math.min(newX, window.innerWidth - element.offsetWidth));
        newY = Math.max(0, Math.min(newY, window.innerHeight - element.offsetHeight));

        element.style.left = `${newX}px`;
        element.style.top = `${newY}px`;
    });

    document.addEventListener('mouseup', () => {
        isDragging = false;
    });
}

// Keyboard Shortcut Visualization
const shortcutDisplay = document.getElementById('shortcut-display');
let shortcutTimeout;

window.addEventListener('keydown', (e) => {
    // Ignore if typing in an input field (though we don't have text inputs yet, it's good practice)
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
        return;
    }

    // Capture the key
    let key = e.key;

    // Make special keys more readable
    if (key === ' ') {
        key = 'Space';
    } else if (key.length === 1) {
        key = key.toUpperCase();
    }

    // If modifiers are pressed, show combination
    const modifiers = [];
    if (e.ctrlKey) modifiers.push('Ctrl');
    if (e.altKey) modifiers.push('Alt');
    if (e.shiftKey) modifiers.push('Shift');
    if (e.metaKey) modifiers.push('Cmd'); // Command key on Mac

    if (modifiers.length > 0 && !modifiers.includes(key)) {
        // Avoid duplicates like "Shift + Shift"
        if (key === 'Control' || key === 'Alt' || key === 'Shift' || key === 'Meta') {
            // Just show modifiers if only modifier is pressed (or keep accumulating)
            // For simplicity, let's just show what we have so far
            shortcutDisplay.textContent = modifiers.join(' + ');
        } else {
            shortcutDisplay.textContent = modifiers.join(' + ') + ' + ' + key;
        }
    } else {
        // Filter out isolated modifier key presses if we want, or show them.
        // User asked for "types on keyboard", usually means characters, but shortcuts include modifiers.
        // Let's show everything.
        shortcutDisplay.textContent = key;
    }

    // Show the display
    shortcutDisplay.classList.add('show');

    // Reset fade out timer
    clearTimeout(shortcutTimeout);
    shortcutTimeout = setTimeout(() => {
        shortcutDisplay.classList.remove('show');
    }, 1500); // Fade out after 1.5 seconds
});

function playBeep() {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(1000, audioCtx.currentTime); // 1000 Hz
    gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime); // 10% volume

    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 0.1); // Beep for 0.1 seconds
}

function runCountdown(seconds) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.id = 'countdown-overlay';
        document.body.appendChild(overlay);

        let count = seconds;
        overlay.textContent = count;
        playBeep();

        const interval = setInterval(() => {
            count--;
            if (count > 0) {
                overlay.textContent = count;
                playBeep();
            } else {
                clearInterval(interval);
                overlay.remove();
                resolve();
            }
        }, 1000);
    });
}