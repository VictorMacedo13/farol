# Farol

Monorepo de salas de compartilhamento de tela com Next.js, Node.js, WebSocket e WebRTC.

## Rodar localmente

```bash
npm install
npm run dev
```

Abra `http://localhost:3000`. O frontend usa `ws://localhost:8787` para sinalização. Para testar entre dispositivos na mesma rede, defina `NEXT_PUBLIC_SIGNAL_URL` para o endereço do servidor Node acessível pela rede.

## Deploy

Publique `apps/web` como uma aplicação Next.js e `apps/signaling` como um processo Node que aceite conexões WebSocket. No frontend, configure `NEXT_PUBLIC_SIGNAL_URL` com a URL pública do sinalizador, usando `wss://` quando o site estiver em HTTPS:

```env
NEXT_PUBLIC_SIGNAL_URL=wss://signal.seu-dominio.com
```

O proxy do domínio do servidor Node precisa encaminhar o upgrade WebSocket. Em produção, configure STUN e TURN no `RTCPeerConnection`; o STUN público incluído ajuda em redes simples, mas um TURN é necessário para usuários atrás de NAT restritivo ou redes corporativas.

Cada pessoa pode compartilhar uma tela ao mesmo tempo. O navegador solicitará permissão de captura para cada participante, e o áudio do sistema só será enviado quando o navegador e a opção escolhida permitirem.
