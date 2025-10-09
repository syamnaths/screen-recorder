const toggleRecordingBtn = document.getElementById('toggleRecording');
const recordingList = document.getElementById('recordingList');

let isRecording = false;
let mediaRecorder;
let stream;
let recordedChunks = [];
let writableStream = null;

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
    try {
        let fileHandle;
        // Use the efficient File System Access API if available (Chrome/Edge)
        if ('showSaveFilePicker' in window) {
            fileHandle = await getOutputFileHandle();
            if (!fileHandle) {
                // User cancelled the file picker
                return;
            }
        }

        const videoStream = await navigator.mediaDevices.getDisplayMedia({
            video: { mediaSource: 'screen' }
        });

        let audioStream;
        try {
            audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (err) {
            console.warn("Could not get microphone audio. Recording without audio.");
        }

        const tracks = [...videoStream.getTracks()];
        if (audioStream) {
            tracks.push(...audioStream.getAudioTracks());
        }

        stream = new MediaStream(tracks);

        console.log("Audio Tracks: ", stream.getAudioTracks());
        if (stream.getAudioTracks().length === 0) {
            console.warn("No audio track was found. Audio will not be recorded.");
        }

        if (fileHandle) {
            await startRecordingWithFileSystemAccess(fileHandle);
        } else {
            // Fallback for other browsers (Firefox/Safari)
            startRecordingWithFallback();
        }

    } catch (err) {
        console.error("Error starting recording: ", err);
        // Handle cases where user denies screen sharing permission
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
        }
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
    isRecording = false;
    toggleRecordingBtn.textContent = 'Record Screen';
    toggleRecordingBtn.classList.remove('recording');
    stream = null;
    mediaRecorder = null;
}
