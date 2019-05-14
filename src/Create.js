

import React from 'react'
import ReactDOM from 'react-dom';
import PropTypes from 'prop-types'
import VideoRecorder from 'react-video-recorder'
import { blobToArrayBuffer } from 'blob-util'
import play from 'audio-play'
import axios, { post } from 'axios';
import { WaveFile } from 'wavefile';
import {Howl, Howler} from 'howler';
import LoadingScreen from 'react-loading-screen';


//require('wavesurfer.js');


class Create extends React.Component {

  constructor(props){
    super(props);
    this.state = {
      loading: false,
      notes: [],
      file: '',
      result: '',
      done: false
    }
    this.beforeCamera = this.beforeCamera.bind(this);
    this.afterVideoCaptured = this.afterVideoCaptured.bind(this);
    this.bufferToWave = this.bufferToWave.bind(this);
    this.playWave = this.playWave.bind(this);

  }

  // Convert an AudioBuffer to a Blob using WAVE representation
  bufferToWave(abuffer, len) {
    var numOfChan = abuffer.numberOfChannels,
        length = len * numOfChan * 2 + 44,
        buffer = new ArrayBuffer(length),
        view = new DataView(buffer),
        channels = [], i, sample,
        offset = 0,
        pos = 0;

    // write WAVE header
    setUint32(0x46464952);                         // "RIFF"
    setUint32(length - 8);                         // file length - 8
    setUint32(0x45564157);                         // "WAVE"

    setUint32(0x20746d66);                         // "fmt " chunk
    setUint32(16);                                 // length = 16
    setUint16(1);                                  // PCM (uncompressed)
    setUint16(numOfChan);
    setUint32(abuffer.sampleRate);
    setUint32(abuffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
    setUint16(numOfChan * 2);                      // block-align
    setUint16(16);                                 // 16-bit (hardcoded in this demo)

    setUint32(0x61746164);                         // "data" - chunk
    setUint32(length - pos - 4);                   // chunk length

    // write interleaved data
    for(i = 0; i < abuffer.numberOfChannels; i++)
      channels.push(abuffer.getChannelData(i));

    while(pos < length) {
      for(i = 0; i < numOfChan; i++) {             // interleave channels
        sample = Math.max(-1, Math.min(1, channels[i][offset])); // clamp
        sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767)|0; // scale to 16-bit signed int
        view.setInt16(pos, sample, true);          // write 16-bit sample
        pos += 2;
      }
      offset++                                     // next source sample
    }

    // create Blob
    return new Blob([buffer], {type: "audio/wav"});

    function setUint16(data) {
      view.setUint16(pos, data, true);
      pos += 2;
    }

    function setUint32(data) {
      view.setUint32(pos, data, true);
      pos += 4;
    }
  }

  beforeCamera() {
    navigator.mediaDevices.getUserMedia({ audio: true });
  }

  afterVideoCaptured(result) {
    var that = this;
    var audioContext = new(window.AudioContext || window.webkitAudioContext)();
    console.log(result);
    var videoUrl = window.URL.createObjectURL(result);
    that.setState({
      result: videoUrl,
      loading: true
    });
    let videoFileAsBuffer;
    let reader = new FileReader();
    blobToArrayBuffer(result).then(function (arrayBuff) {
      // successconsol
      console.log(arrayBuff);
      audioContext.decodeAudioData(arrayBuff).then(function (decodedAudioData) {
        let length = decodedAudioData.length;
        let wave = that.bufferToWave(decodedAudioData, length);
        let wav_file = new File([wave], "audio.wav", { type: "audio/wav", lastModified: Date.now() });

        let midi_notes = ["C", "D-", "C#", "D", "E-", "D#", "E", "F", "G-", "F#", "G", "A-", "G#", "A", "B-", "A#", "B"];

        fetch("https://toomuch-rest.herokuapp.com/api/predict")
          .then(res => res.json())
          .then((res) => {
            if (res.response.notes) {
              let notes = res.response.notes.replace("[", "").replace("]", "").replace(/<music21.pitch.Pitch /g, '').replace(/>/g, '');
              let notesArr = notes.split(", ");
              let noteNumbers = []
              console.log(notes);

              for (let i=0; i<notesArr.length; i++) {
                let octave = notesArr[i][notesArr[i].length - 1];
                let soundStr = notesArr[i].substring(0, notesArr[i].length-1);
                let shift = 12 * (octave - 1);
                let sound = midi_notes.indexOf(soundStr);
                let constant = 21;
                let note = constant + shift + sound;
                noteNumbers.push(constant + shift + sound);
              }

              let notesStr = noteNumbers.join("-");
              notesStr += "-...";
              console.log(notesStr);
              that.setState({notes: notesStr});
            }
          })
          .then(() => {



             const url = 'https://api.sonicapi.com/process/elastiqueTune?access_id=9ec49f58-75f5-4af7-83de-4c6ba79b36fe';
             const formData = new FormData();
             formData.append('input_file',wav_file)
             formData.append('blocking','false')
             formData.append('begin_seconds', '0')
             //formData.append('end_seconds', JSON.stringify(that.video.duration))
             formData.append('midi_pitches', that.state.notes);
             formData.append('format','json')

             const config = {
                headers: {
                    'content-type': 'multipart/form-data'
                }
            }
             post(url, formData,config).then((response)=>{

                console.log(response);

                var fileId = response.data.file.file_id;
                var accessId = '9ec49f58-75f5-4af7-83de-4c6ba79b36fe';

                // request task progress every 500ms
                var polling = setInterval(pollTaskProgress, 500);

                function pollTaskProgress() {
                    fetch('https://api.sonicAPI.com/file/status?file_id=' + fileId + '&access_id=' + accessId + '&format=json')
                    .then(res => res.json())
                    .then((data) => {
                        if (data.file.status == 'ready') {
                            console.log('yay! we got it');
                            onTaskSucceeded(fileId);
                            clearInterval(polling);

                        } else if (data.file.status == 'working') {
                            console.log(data.file.progress + '% done');
                        }
                    });
                }

                function onTaskSucceeded(fileId) {
                   // create HTML5 audio player
                   var downloadUrl = 'https://api.sonicAPI.com/file/download?file_id=' + fileId + '&access_id=' + accessId + '&format=mp3-cbr';

                    that.setState({
                      done: true,
                      file: downloadUrl,
                      loading: false
                    });

                    setInterval(function() {
                      that.audio.play();
                      that.video.play();
                      console.log(that.audio.duration, that.video.duration);
                    }, Math.floor(that.audio.duration * 1000));




                }

             });

          });

      });
    });

  }

  playWave(byteArray) {
    var audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    var myAudioBuffer = audioCtx.createBuffer(1, byteArray.length, 44100);
    var nowBuffering = myAudioBuffer.getChannelData(0);
    for (var i = 0; i < byteArray.length; i++) {
        nowBuffering[i] = byteArray[i];
    }

    var source = audioCtx.createBufferSource();
    source.buffer = myAudioBuffer;
    source.connect(audioCtx.destination);
    source.start();
  }

  render () {

    var recorder;

    if (!this.state.done) {
      recorder = <VideoRecorder className={(this.state.done) ? 'hidden' : ''}  onTurnOnCamera={this.beforeCamera} onRecordingComplete={this.afterVideoCaptured}/>
    } else {
      recorder = <div/>
    }

    return(
      <div className="Create">
        {recorder}

          <LoadingScreen
          loading={this.state.loading}
          bgColor='#000000cc'
          spinnerColor='#9ee5f8'
          textColor='#fff'
          text='Wait while we make your voice pitch perfect. -Ish'
        >
          <audio className="hidden" id="player" ref={(audio) => { this.audio = audio; }} controls loop src={this.state.file} type="audio/wav"></audio>
          <video className={(!this.state.done) ? 'hidden video-output' : 'video-output'} ref={(video) => { this.video = video; }} src={this.state.result} muted loop></video>
        </LoadingScreen>
      </div>
    )
  }
}

export default Create;
