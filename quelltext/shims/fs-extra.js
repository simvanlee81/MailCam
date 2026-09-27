// Leerer Platzhalter: im Browser nicht genutzt
const leer = new Proxy(function () {}, { get: () => leer, apply: () => leer, construct: () => ({}) });
export default leer;
