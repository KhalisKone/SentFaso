// Serveur HTTP du service (Node 20+, aucune dépendance). Render fournit PORT.
import { createServer } from "node:http";
import { creerService, CONFIG } from "./service.js";

const PORT = Number(process.env.PORT || 3000);
const ENTETES = ["x-socle-service", "x-socle-horodatage", "x-socle-signature"];
const service = await creerService(process.env);

createServer(async (req, res) => {
  try {
    const entetes = Object.fromEntries(ENTETES.filter(h => req.headers[h]).map(h => [h, String(req.headers[h])]));
    const r = await service.traiter(new Request(`http://localhost${req.url}`, { method: req.method, headers: entetes }));
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    console.error(e);
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ erreur: "erreur interne" }));
  }
}).listen(PORT, "0.0.0.0", () => console.log(`Service ${CONFIG.nom} sur le port ${PORT} (registre ${service.origine})`));
