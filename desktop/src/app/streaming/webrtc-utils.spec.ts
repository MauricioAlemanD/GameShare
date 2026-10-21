import { enableOpusStereo, sortVideoCodecs, summarizeInbound, summarizeOutbound, validateSignal } from './webrtc-utils';

const LINK = 'abcdEFGH1234';

describe('validateSignal (mensajes remotos no fiables)', () => {
  it('acepta ofertas, respuestas, candidatos y bye válidos', () => {
    expect(validateSignal({ kind: 'offer', linkId: LINK, sdp: 'v=0\r\n...' })).toEqual({ kind: 'offer', linkId: LINK, sdp: 'v=0\r\n...' });
    expect(validateSignal({ kind: 'answer', linkId: LINK, sdp: 'v=0' })?.kind).toBe('answer');
    expect(validateSignal({ kind: 'ice', linkId: LINK, candidate: { candidate: 'candidate:1 1 udp ...', sdpMid: '0', sdpMLineIndex: 0 } }))
      .toEqual({ kind: 'ice', linkId: LINK, candidate: { candidate: 'candidate:1 1 udp ...', sdpMid: '0', sdpMLineIndex: 0 } });
    expect(validateSignal({ kind: 'bye', linkId: LINK })).toEqual({ kind: 'bye', linkId: LINK });
  });

  it.each([
    ['null', null],
    ['tipo desconocido', { kind: 'exec', linkId: LINK }],
    ['sin linkId', { kind: 'bye' }],
    ['linkId con caracteres raros', { kind: 'bye', linkId: '../../etc' }],
    ['SDP que no empieza por v=0', { kind: 'offer', linkId: LINK, sdp: '<script>' }],
    ['SDP enorme', { kind: 'offer', linkId: LINK, sdp: 'v=0' + 'x'.repeat(40_000) }],
    ['candidato sin texto', { kind: 'ice', linkId: LINK, candidate: { candidate: 5 } }],
    ['sdpMLineIndex negativo', { kind: 'ice', linkId: LINK, candidate: { candidate: 'c', sdpMLineIndex: -1 } }],
    ['sdpMid no textual', { kind: 'ice', linkId: LINK, candidate: { candidate: 'c', sdpMid: {} } }],
  ])('rechaza %s', (_name, data) => {
    expect(validateSignal(data)).toBeNull();
  });
});

describe('enableOpusStereo', () => {
  const sdp = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10;useinbandfec=1\r\n';

  it('añade estéreo y bitrate a la línea fmtp de Opus', () => {
    const out = enableOpusStereo(sdp);
    expect(out).toContain('a=fmtp:111 minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1;maxaveragebitrate=128000');
  });

  it('es idempotente', () => {
    expect(enableOpusStereo(enableOpusStereo(sdp))).toBe(enableOpusStereo(sdp));
  });

  it('crea la línea fmtp si no existe y no toca SDP sin Opus', () => {
    expect(enableOpusStereo('v=0\r\na=rtpmap:96 opus/48000/2\r\n')).toContain('a=fmtp:96 stereo=1;sprop-stereo=1;maxaveragebitrate=128000');
    expect(enableOpusStereo('v=0\r\nm=video 9\r\n')).toBe('v=0\r\nm=video 9\r\n');
  });
});

describe('sortVideoCodecs', () => {
  const codecs = [
    { mimeType: 'video/VP8' },
    { mimeType: 'video/H264', sdpFmtpLine: 'profile-level-id=640c1f;packetization-mode=1' },
    { mimeType: 'video/rtx' },
    { mimeType: 'video/H264', sdpFmtpLine: 'profile-level-id=42e01f;packetization-mode=1' },
    { mimeType: 'video/H264', sdpFmtpLine: 'profile-level-id=42e01f;packetization-mode=0' },
    { mimeType: 'video/AV1' },
  ];

  it('prioriza H.264 High con packetization-mode=1 y deja Constrained Baseline (software) al final', () => {
    const sorted = sortVideoCodecs(codecs, 'H264');
    expect(sorted.map((c) => c.sdpFmtpLine).slice(0, 3)).toEqual([
      'profile-level-id=640c1f;packetization-mode=1',
      'profile-level-id=42e01f;packetization-mode=1',
      'profile-level-id=42e01f;packetization-mode=0',
    ]);
    expect(sorted).toHaveLength(codecs.length); // no elimina ninguno (rtx, fallback)
  });

  it('ordena Main y Baseline entre High y Constrained Baseline', () => {
    const list = [
      { mimeType: 'video/H264', sdpFmtpLine: 'packetization-mode=1;profile-level-id=42e01f' },
      { mimeType: 'video/H264', sdpFmtpLine: 'packetization-mode=1;profile-level-id=42001f' },
      { mimeType: 'video/H264', sdpFmtpLine: 'packetization-mode=1;profile-level-id=4d001f' },
      { mimeType: 'video/H264', sdpFmtpLine: 'packetization-mode=1;profile-level-id=64001f' },
    ];
    expect(sortVideoCodecs(list, 'H264').map((c) => c.sdpFmtpLine.slice(-6))).toEqual(['64001f', '4d001f', '42001f', '42e01f']);
  });

  it('respeta el códec elegido', () => {
    expect(sortVideoCodecs(codecs, 'AV1')[0].mimeType).toBe('video/AV1');
  });
});

describe('estadísticas', () => {
  const common = [
    { type: 'transport', id: 'T', selectedCandidatePairId: 'CP' },
    { type: 'candidate-pair', id: 'CP', localCandidateId: 'L', remoteCandidateId: 'R', currentRoundTripTime: 0.042 },
    { type: 'local-candidate', id: 'L', candidateType: 'srflx' },
    { type: 'remote-candidate', id: 'R', candidateType: 'host' },
    { type: 'codec', id: 'C1', mimeType: 'video/H264' },
  ];

  it('calcula bitrate, pérdida y latencia de la recepción', () => {
    const first = summarizeInbound(
      [...common, { type: 'inbound-rtp', id: 'V', kind: 'video', bytesReceived: 0, packetsLost: 0, packetsReceived: 0 }],
      null,
      0,
    );
    expect(first.stats.bitrateKbps).toBeNull();
    const second = summarizeInbound(
      [
        ...common,
        {
          type: 'inbound-rtp', id: 'V', kind: 'video', codecId: 'C1', bytesReceived: 1_250_000, packetsLost: 10,
          packetsReceived: 990, framesPerSecond: 59.8, jitter: 0.004, frameWidth: 1920, frameHeight: 1080,
          decoderImplementation: 'ExternalDecoder (D3D11VideoDecoder)', powerEfficientDecoder: true,
        },
      ],
      first.sample,
      1000,
    );
    expect(second.stats).toMatchObject({
      rttMs: 42, fps: 59.8, bitrateKbps: 10_000, packetLossPct: 1, jitterMs: 4, width: 1920, height: 1080,
      codec: 'H264', hardware: true, path: 'direct',
    });
  });

  it('detecta la retransmisión por TURN', () => {
    const relay = common.map((s) => (s.id === 'L' ? { ...s, candidateType: 'relay' } : s));
    expect(summarizeInbound(relay, null, 0).stats.path).toBe('relay');
  });

  it('resume el envío con el codificador y la limitación de calidad', () => {
    const out = summarizeOutbound(
      [
        ...common,
        {
          type: 'outbound-rtp', id: 'O', kind: 'video', codecId: 'C1', bytesSent: 0, packetsSent: 0, framesPerSecond: 60,
          encoderImplementation: 'MediaFoundationVideoEncodeAccelerator', powerEfficientEncoder: true,
          qualityLimitationReason: 'bandwidth', frameWidth: 1280, frameHeight: 720,
        },
        { type: 'remote-inbound-rtp', id: 'RI', kind: 'video', fractionLost: 0.025, jitter: 0.002 },
      ],
      null,
      0,
    );
    expect(out.stats).toMatchObject({
      fps: 60, hardware: true, implementation: 'MediaFoundationVideoEncodeAccelerator',
      qualityLimitation: 'bandwidth', packetLossPct: 2.5, jitterMs: 2, width: 1280,
    });
  });

  it('sin conexión seleccionada la ruta es desconocida', () => {
    expect(summarizeInbound([], null, 0).stats.path).toBe('unknown');
  });
});
