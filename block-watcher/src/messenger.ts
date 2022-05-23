import dgram from "dgram";

const server = dgram.createSocket("udp4");

server.bind(function () {
  server.setBroadcast(true);
});
