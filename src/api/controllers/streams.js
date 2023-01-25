const _ = require('lodash');
const NodeTransServer = require('../../node_trans_server');
// const Logger = require("../../node_core_logger");
const {spawn} = require("child_process");

function postStreamTrans(req, res, next) {
  let config = req.body;
  if (
    config.app &&
    config.hls &&
    config.ac &&
    config.vc &&
    config.hlsFlags &&
    config.dash &&
    config.dashFlags
  ) {
    let transServer = new NodeTransServer(config);
    console.log(req.body);
    if (transServer) {
      res.json({ message: 'OK Success' });
    } else {
      res.status(404);
      res.json({ message: 'Failed creating stream' });
    }
  } else {
    res.status(404);
    res.json({ message: 'Failed creating stream' });
  }
}

function concatStreams(req, res, next) {
  const body = req.body;
  const {firstStream, secondStream} = body;
  const app = 'newUuid'
  const newStreamUrl = 'rtmp://localhost/' + app
  let format = 'flv';
  const filterComplex = '"[1:v]scale=200:200,pad=200:200:(ow-iw)/2:(oh-ih)/2[small];[0:v][small]overlay=10:10[outv];[0:a]' +
      'volume=1[a1];[1:a]volume=0.5[a2]; [a1][a2]amix=inputs=2[aout]"'
  let argv = ['-i', firstStream, '-i', secondStream, '-filter_complex', filterComplex, '-map', '"[outv]"', '-map',
      '"[aout]"', '-f', format, '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-b:v', '2000k', newStreamUrl];
  // const ffmpegString = 'ffmpeg -i ' + 'sdf' + ' -i ' + 'df' +
  //     ' -filter_complex "[1:v]scale=200:200,pad=200:200:(ow-iw)/2:(oh-ih)/2[small];[0:v][small]overlay=10:10[outv];[0:a]' +
  //     'volume=10[a1];[1:a]volume=0.5[a2]; [a1][a2]amix=inputs=2[aout]" -map "[outv]" -map "[aout]" -f flv -c:v libx264' +
  //     ' -preset ultrafast -tune zerolatency -b:v 2000k ' + newStreamUrl;

  console.log('[CONCAT stream task] ', 'cmd=ffmpeg', argv.join(' '));

  const ffmpeg_exec = spawn('ffmpeg', argv);
  ffmpeg_exec.on('error', (e) => {
    console.log(e);
  });

  ffmpeg_exec.stdout.on('data', (data) => {
    console.log(`FF_LOG:${data}`);
  });

  ffmpeg_exec.stderr.on('data', (data) => {
    console.log(`FF_LOG:${data}`);
  });

  ffmpeg_exec.on('close', (code) => {
    console.log('[CONCAT end] ', 'code=' + code);
    // this.emit('end', this.id);
  });

  res.status(201)
  res.json({
    app: app,
  })
}

function getStreams(req, res, next) {
  let stats = {};

  this.sessions.forEach(function(session, id) {
    if (session.isStarting) {
      let regRes = /\/(.*)\/(.*)/gi.exec(
        session.publishStreamPath || session.playStreamPath
      );

      if (regRes === null) return;

      let [app, stream] = _.slice(regRes, 1);

      if (!_.get(stats, [app, stream])) {
        _.setWith(stats, [app, stream], {
          publisher: null,
          subscribers: []
        }, Object);
      }

      switch (true) {
      case session.isPublishing: {
        _.setWith(stats, [app, stream, 'publisher'], {
          app: app,
          stream: stream,
          clientId: session.id,
          connectCreated: session.connectTime,
          bytes: session.socket.bytesRead,
          ip: session.socket.remoteAddress,
          audio: session.audioCodec > 0 ? {
            codec: session.audioCodecName,
            profile: session.audioProfileName,
            samplerate: session.audioSamplerate,
            channels: session.audioChannels
          } : null,
          video: session.videoCodec > 0 ? {
            codec: session.videoCodecName,
            width: session.videoWidth,
            height: session.videoHeight,
            profile: session.videoProfileName,
            level: session.videoLevel,
            fps: session.videoFps
          } : null,
        },Object);
        break;
      }
      case !!session.playStreamPath: {
        switch (session.constructor.name) {
        case 'NodeRtmpSession': {
          stats[app][stream]['subscribers'].push({
            app: app,
            stream: stream,
            clientId: session.id,
            connectCreated: session.connectTime,
            bytes: session.socket.bytesWritten,
            ip: session.socket.remoteAddress,
            protocol: 'rtmp'
          });

          break;
        }
        case 'NodeFlvSession': {
          stats[app][stream]['subscribers'].push({
            app: app,
            stream: stream,
            clientId: session.id,
            connectCreated: session.connectTime,
            bytes: session.req.connection.bytesWritten,
            ip: session.req.connection.remoteAddress,
            protocol: session.TAG === 'websocket-flv' ? 'ws' : 'http'
          });

          break;
        }
        }

        break;
      }
      }
    }
  });
  res.json(stats);
}

function getStream(req, res, next) {
  let streamStats = {
    isLive: false,
    viewers: 0,
    duration: 0,
    bitrate: 0,
    startTime: null,
    arguments: {}
  };

  let publishStreamPath = `/${req.params.app}/${req.params.stream}`;

  let publisherSession = this.sessions.get(
    this.publishers.get(publishStreamPath)
  );

  streamStats.isLive = !!publisherSession;
  streamStats.viewers = _.filter(
    Array.from(this.sessions.values()),
    session => {
      return session.playStreamPath === publishStreamPath;
    }
  ).length;
  streamStats.duration = streamStats.isLive
    ? Math.ceil((Date.now() - publisherSession.startTimestamp) / 1000)
    : 0;
  streamStats.bitrate =
    streamStats.duration > 0 ? publisherSession.bitrate : 0;
  streamStats.startTime = streamStats.isLive
    ? publisherSession.connectTime
    : null;
  streamStats.arguments = !!publisherSession ? publisherSession.publishArgs : {};

  res.json(streamStats);
}

function delStream(req, res, next) {
  let publishStreamPath = `/${req.params.app}/${req.params.stream}`;
  let publisherSession = this.sessions.get(
    this.publishers.get(publishStreamPath)
  );

  if (publisherSession) {
    publisherSession.stop();
    res.json('ok');
  } else {
    res.json({ error: 'stream not found' }, 404);
  }
}

exports.delStream = delStream;
exports.getStreams = getStreams;
exports.getStream = getStream;
exports.postStreamTrans = postStreamTrans;
exports.concatStreams = concatStreams;
