"use client";

import { useEffect, useRef, useState } from "react";

type RemoteStream = { peerId: string; stream: MediaStream; local?: boolean };
type Signal = { type: string; [key: string]: unknown };

const SIGNAL_URL = process.env.NEXT_PUBLIC_SIGNAL_URL ?? (typeof window !== "undefined" ? `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.hostname}:8787` : "ws://localhost:8787");

if (typeof window !== "undefined") {
  console.info("[farol:websocket] SIGNAL_URL:", SIGNAL_URL);
}

export default function Home() {
  const [roomId, setRoomId] = useState("");
  const [roomInput, setRoomInput] = useState("");
  const [inRoom, setInRoom] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [remoteStreams, setRemoteStreams] = useState<RemoteStream[]>([]);
  const [peerIds, setPeerIds] = useState<string[]>([]);
  const [status, setStatus] = useState("Pronto para começar");
  const socket = useRef<WebSocket | null>(null);
  const clientId = useRef("");
  const peers = useRef(new Map<string, RTCPeerConnection>());
  const localStream = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (inRoom) setStatus(`${peerIds.length + 1} pessoa${peerIds.length === 0 ? "" : "s"} na sala`);
  }, [inRoom, peerIds]);

  useEffect(() => () => {
    localStream.current?.getTracks().forEach((track) => track.stop());
    peers.current.forEach((peer) => peer.close());
    socket.current?.close();
  }, []);

  function connect() {
    if (socket.current?.readyState === WebSocket.OPEN) return socket.current;
    console.info("[farol:websocket] abrindo conexão", { url: SIGNAL_URL });
    const connection = new WebSocket(SIGNAL_URL);
    socket.current = connection;
    connection.onopen = () => {
      console.info("[farol:websocket] conectado", { url: SIGNAL_URL });
      setStatus("Conectado ao servidor");
    };
    connection.onerror = (event) => {
      console.error("[farol:websocket] erro", { url: SIGNAL_URL, event });
      setStatus("Não foi possível conectar ao servidor");
    };
    connection.onclose = (event) => console.warn("[farol:websocket] conexão encerrada", { url: SIGNAL_URL, code: event.code, reason: event.reason });
    connection.onmessage = (event) => {
      const message = JSON.parse(event.data) as Signal;
      console.debug("[farol:websocket] recebido", { url: SIGNAL_URL, type: message.type });
      void handleSignal(message);
    };
    return connection;
  }

  function send(message: Signal) {
    if (socket.current?.readyState === WebSocket.OPEN) {
      console.debug("[farol:websocket] enviado", { url: SIGNAL_URL, type: message.type, target: message.target });
      socket.current.send(JSON.stringify(message));
    } else {
      console.warn("[farol:websocket] envio ignorado: conexão não está aberta", { url: SIGNAL_URL, type: message.type });
    }
  }

  async function createRoom() {
    const connection = connect();
    const open = () => send({ type: "create-room" });
    connection.readyState === WebSocket.OPEN ? open() : connection.addEventListener("open", open, { once: true });
  }

  async function joinRoom() {
    const code = roomInput.trim().toUpperCase();
    if (!code) return;
    const connection = connect();
    const open = () => send({ type: "join-room", roomId: code });
    connection.readyState === WebSocket.OPEN ? open() : connection.addEventListener("open", open, { once: true });
  }

  async function handleSignal(message: Signal) {
    if (message.type === "ready") { clientId.current = String(message.clientId); return; }
    if (message.type === "room-created" || message.type === "room-joined") {
      setRoomId(String(message.roomId));
      setInRoom(true);
      setStatus("Sala conectada");
      const peersInRoom = (message.peers as string[] | undefined) ?? [];
      setPeerIds(peersInRoom);
      for (const peerId of peersInRoom) await makeOffer(peerId);
      return;
    }
    if (message.type === "peer-joined") {
      const peerId = String(message.peerId);
      setPeerIds((ids) => ids.includes(peerId) ? ids : [...ids, peerId]);
      if (localStream.current) await makeOffer(peerId);
      return;
    }
    if (message.type === "offer") {
      const peer = getPeer(String(message.from));
      await peer.setRemoteDescription(message.offer as RTCSessionDescriptionInit);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      send({ type: "answer", target: String(message.from), answer });
      return;
    }
    if (message.type === "answer") { await peers.current.get(String(message.from))?.setRemoteDescription(message.answer as RTCSessionDescriptionInit); return; }
    if (message.type === "ice-candidate") {
      const candidate = message.candidate as RTCIceCandidateInit;
      await peers.current.get(String(message.from))?.addIceCandidate(candidate).catch(() => undefined);
      return;
    }
    if (message.type === "peer-left") {
      const peerId = String(message.peerId);
      setPeerIds((ids) => ids.filter((id) => id !== peerId));
      removePeer(peerId);
    }
    if (message.type === "error") setStatus(String(message.message));
  }

  function getPeer(peerId: string) {
    const existing = peers.current.get(peerId);
    if (existing) return existing;
    const peer = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    peer.onicecandidate = (event) => { if (event.candidate) send({ type: "ice-candidate", target: peerId, candidate: event.candidate }); };
    peer.ontrack = (event) => setRemoteStreams((streams) => streams.some((item) => item.peerId === peerId) ? streams : [...streams, { peerId, stream: event.streams[0] }]);
    localStream.current?.getTracks().forEach((track) => peer.addTrack(track, localStream.current as MediaStream));
    peers.current.set(peerId, peer);
    return peer;
  }

  async function makeOffer(peerId: string) {
    const peer = getPeer(peerId);
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    send({ type: "offer", target: peerId, offer });
  }

  function removePeer(peerId: string) {
    peers.current.get(peerId)?.close();
    peers.current.delete(peerId);
    setRemoteStreams((streams) => streams.filter((stream) => stream.peerId !== peerId));
  }

  async function shareScreen() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      localStream.current = stream;
      setRemoteStreams((streams) => [{ peerId: "local-screen", stream: new MediaStream(stream.getVideoTracks()), local: true }, ...streams.filter((item) => item.peerId !== "local-screen")]);
      setIsSharing(true);
      setStatus("Sua tela está ao vivo");
      for (const [peerId, peer] of peers.current) {
        stream.getTracks().forEach((track) => peer.addTrack(track, stream));
        await makeOffer(peerId);
      }
      stream.getVideoTracks()[0]?.addEventListener("ended", stopSharing);
    } catch { setStatus("A captura de tela foi cancelada"); }
  }

  function stopSharing() {
    const tracks = localStream.current?.getTracks() ?? [];
    for (const [peerId, peer] of peers.current) {
      peer.getSenders().filter((sender) => sender.track && tracks.includes(sender.track)).forEach((sender) => peer.removeTrack(sender));
      void makeOffer(peerId);
    }
    tracks.forEach((track) => track.stop());
    localStream.current = null;
    setRemoteStreams((streams) => streams.filter((item) => item.peerId !== "local-screen"));
    setIsSharing(false);
    setStatus("Transmissão encerrada");
  }

  if (!inRoom) return <Landing roomInput={roomInput} setRoomInput={setRoomInput} createRoom={createRoom} joinRoom={joinRoom} status={status} />;
  return <Room roomId={roomId} status={status} isSharing={isSharing} localStream={localStream.current} peerIds={peerIds} remoteStreams={remoteStreams} shareScreen={shareScreen} stopSharing={stopSharing} />;
}

function Landing({ roomInput, setRoomInput, createRoom, joinRoom, status }: { roomInput: string; setRoomInput: (value: string) => void; createRoom: () => void; joinRoom: () => void; status: string }) {
  return <main className="landing"><div className="topbar"><div className="brand"><span className="brand-mark" />farol</div><span className="connection">● {status}</span><span className="avatar">VC</span></div><section className="hero"><div className="hero-copy"><p className="eyebrow">sala de transmissão ao vivo</p><h1>Veja junto.<br /><em>Esteja presente.</em></h1><p className="lead">Compartilhe sua tela com imagem e áudio em uma sala privada. A conversa acontece em tempo real.</p><div className="actions"><button className="primary" onClick={createRoom}>+ Criar uma sala</button><div className="join"><input value={roomInput} onChange={(event) => setRoomInput(event.target.value)} onKeyDown={(event) => event.key === "Enter" && joinRoom()} placeholder="código da sala" aria-label="Código da sala" /><button onClick={joinRoom}>Entrar →</button></div></div><small>conexão WebRTC criptografada · até 50 pessoas</small></div><div className="hero-visual"><div className="visual-label">● ao vivo agora</div><div className="mock-screen"><div className="mock-bar"><i /><i /><i /> apresentação / projeto</div><div className="mock-content"><span>IDEIAS EM MOVIMENTO</span><strong>Um espaço<br />para criar<br /><b>juntos.</b></strong></div></div><div className="visual-foot">◉ 8 pessoas assistindo</div></div></section></main>;
}

function Room({ roomId, status, isSharing, localStream, peerIds, remoteStreams, shareScreen, stopSharing }: { roomId: string; status: string; isSharing: boolean; localStream: MediaStream | null; peerIds: string[]; remoteStreams: RemoteStream[]; shareScreen: () => void; stopSharing: () => void }) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  async function toggleFullscreen() {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await stageRef.current?.requestFullscreen();
    setIsFullscreen(Boolean(document.fullscreenElement));
  }
  return <main className="room"><div className="topbar"><div className="brand"><span className="brand-mark" />farol</div><span className="connection">● {status}</span><span className="avatar">VC</span></div><header className="room-head"><div><p className="eyebrow">sala privada</p><h1>Sala ao vivo</h1></div><div className="room-code">código <strong>{roomId}</strong><button onClick={() => navigator.clipboard.writeText(roomId)}>⧉</button></div></header><div className="room-grid"><section><div className={`stage ${remoteStreams.length ? "has-remote" : ""}`}>{remoteStreams.length ? remoteStreams.map((item) => <RemoteVideo key={item.peerId} stream={item.stream} />) : <div className="empty"><div className="screen-icon">▣</div><h2>{isSharing ? "Transmitindo sua tela" : "Sua tela ainda não está sendo compartilhada"}</h2><p>{isSharing ? "Aguarde as outras pessoas entrarem na sala." : "Todos na sala poderão acompanhar em tempo real com áudio."}</p>{!isSharing && <button className="primary" onClick={shareScreen}>▣ Compartilhar tela</button>}</div>}{isSharing && <div className="live-badge">● transmissão ao vivo</div>}</div><div className="controls"><button>♩</button><button>◉</button><span>{remoteStreams.length + 1} assistindo</span>{isSharing && <button className="stop" onClick={stopSharing}>Encerrar transmissão</button>}</div></section><aside><div className="side-title"><h2>Pessoas na sala</h2><b>{remoteStreams.length + 1}</b></div><div className="person"><span className="person-avatar p0">VC</span><div><strong>Você</strong><small>{isSharing ? "apresentando agora" : "ouvindo"}</small></div></div>{remoteStreams.map((item, index) => <div className="person" key={item.peerId}><span className={`person-avatar p${(index + 1) % 5}`}>P{index + 1}</span><div><strong>Participante {index + 1}</strong><small>compartilhando tela</small></div></div>)}<hr /><div className="side-title"><h2>Como funciona</h2></div><p className="hint">Várias pessoas podem compartilhar ao mesmo tempo. Cada transmissão aparece em um quadro separado, com áudio quando o navegador permitir.</p></aside></div></main>;
}

function RemoteVideo({ stream, muted = stream.getAudioTracks().length === 0 }: { stream: MediaStream; muted?: boolean }) { const ref = useRef<HTMLVideoElement>(null); useEffect(() => { if (ref.current) ref.current.srcObject = stream; }, [stream]); async function toggleFullscreen() { if (document.fullscreenElement) await document.exitFullscreen(); else await ref.current?.requestFullscreen(); } return <div className="video-tile"><video className="remote-video" ref={ref} autoPlay playsInline muted={muted} /><button className="video-fullscreen" onClick={toggleFullscreen} title="Ver em tela cheia" aria-label="Ver em tela cheia">⛶</button></div>; }
