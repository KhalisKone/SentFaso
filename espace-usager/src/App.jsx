import { Navigate, Route, Routes } from "react-router-dom";
import { Assistant } from "./composants/Assistant.jsx";
import { AvecSocle } from "./mise-en-page/Chargement.jsx";
import { Accueil } from "./pages/Accueil.jsx";
import { Connect } from "./pages/Connect.jsx";
import { Espace } from "./pages/Espace.jsx";
import { Toasts } from "./ui/Toasts.jsx";
import { Telecharger } from "./pages/Telecharger.jsx";

/**
 * Routes (sous /frontend) :
 *   /                         accueil et connexion
 *   /connect                  branchement d'un service (n'a pas besoin de l'état du socle)
 *   /:espace/:module?/:id?    espace citoyen | agent | admin | super-admin
 * L'assistant (mascotte) est présent sur toutes les pages.
 */
export default function App() {
  return (
    <Toasts>
      <Routes>
        <Route path="/" element={<AvecSocle><Accueil /></AvecSocle>} />
        <Route path="/connect" element={<Connect />} />
        <Route path="/telecharger" element={<Telecharger />} />
        <Route path="/:slug/:module?/:id?" element={<AvecSocle><Espace /></AvecSocle>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Assistant />
    </Toasts>
  );
}
