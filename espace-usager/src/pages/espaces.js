/** Registre des espaces : pour chaque acteur, ses modules (menu) et la page qui les affiche. */
import { Admins, JournalGlobal, Services, SuperAdmins } from "./super-admin/SuperAdmin.jsx";
import { SanteRegistres } from "./super-admin/SanteRegistres.jsx";
import { Agents, Demarches, JournalService } from "./admin/Admin.jsx";
import { Dossiers, NouveauDossier } from "./agent/Agent.jsx";
import { Demandes, Depots, Documents, Journal, compteurs } from "./citoyen/Citoyen.jsx";

export const ESPACES = {
  citoyen: [
    { id: "demandes", libelle: "Mes demandes", Page: Demandes, compteur: compteurs.demandes },
    { id: "depots", libelle: "Pièces à fournir", Page: Depots, compteur: compteurs.depots },
    { id: "documents", libelle: "Mes documents", Page: Documents },
    { id: "journal", libelle: "Qui a consulté mes données", Page: Journal },
  ],
  agent: [
    { id: "nouveau", libelle: "Nouveau dossier", Page: NouveauDossier },
    { id: "dossiers", libelle: "Dossiers du service", Page: Dossiers },
  ],
  admin: [
    { id: "demarches", libelle: "Démarches", Page: Demarches },
    { id: "agents", libelle: "Agents du service", Page: Agents },
    { id: "journal", libelle: "Journal du service", Page: JournalService },
  ],
  super_admin: [
    { id: "services", libelle: "Services", Page: Services },
    { id: "sante", libelle: "Santé des registres", Page: SanteRegistres },
    { id: "admins", libelle: "Admins des services", Page: Admins },
    { id: "superadmins", libelle: "Super admins", Page: SuperAdmins },
    { id: "journal", libelle: "Journal global", Page: JournalGlobal },
  ],
};
