"""Contrôle d'accès à l'état du socle : ce que chacun voit (vue) et ce qu'il peut modifier (fusion).

Principe : séparer le pouvoir d'administrer du pouvoir de consulter.
- Citoyen : ses propres dossiers ; il ne peut que déposer ou choisir les pièces qui l'attendent.
- Agent : les dossiers de son service ; il les crée et les suit (jamais un dossier qui le concerne).
- Admin : les démarches et les agents de son service ; aucun dossier.
- Super admin : les services, les admins et les super admins ; aucun dossier.
L'accord du citoyen n'est jamais modifiable par l'état : il appartient à la couche « consentement ».
"""
import copy

from session import Personne, liste



def _droits(p: Personne):
    return p.super_admin, p.services("admin"), p.services("agent")


def vue(etat: dict | None, p: Personne, accords: dict, preferences: dict) -> dict:
    e = etat or {}
    sa, admin_de, agent_de = _droits(p)
    roles = liste(e.get("roles"))
    v_roles = [r for r in roles
               if r.get("iu") == p.iu
               or (sa and r.get("role") in ("admin", "super_admin"))
               or (r.get("role") == "agent" and r.get("service") in admin_de)]
    dossiers = e.get("dossiers") or {}
    v_dossiers = {}
    for k, d in dossiers.items():
        if d.get("iu") == p.iu or d.get("service") in agent_de:
            d = dict(d)
            if k in accords:
                a = accords[k]
                d["consent"] = {"statut": a["statut"], "requis": a.get("requis", False), "autorisees": a.get("pieces", []),
                                "le": a.get("le"), "expire": a.get("expire")}
            v_dossiers[k] = d
    v_demarches = {s: dm for s, dm in (e.get("demarches") or {}).items() if s in admin_de | agent_de}
    ius = {p.iu} | {r.get("iu") for r in v_roles} | {d.get("iu") for d in v_dossiers.values()}
    personnes = e.get("personnes") or {}
    return {
        "services": e.get("services") or {},
        "roles": v_roles,
        "demarches": v_demarches,
        "dossiers": v_dossiers,
        "personnes": {i: personnes[i] for i in ius if i in personnes},
        "preferences": {p.iu: preferences[p.iu]} if p.iu in preferences else {},
        "seq": e.get("seq") or {},
    }


def fusionner(actuel: dict | None, recu: dict, p: Personne) -> tuple[dict, list[str]]:
    """Applique au nouvel état les seules modifications permises à la personne. Renvoie (état, refus)."""
    e = copy.deepcopy(actuel or {})
    sa, admin_de, agent_de = _droits(p)
    refus = []

    seq = e.setdefault("seq", {})
    for k, v in (recu.get("seq") or {}).items():
        if isinstance(v, int):
            seq[k] = max(seq.get(k, 0), v)

    if sa:
        supprimes = e.get("supprimes") or {}
        for k, s in (recu.get("services") or {}).items():
            if k in supprimes and k not in (e.get("services") or {}):
                continue  # supprimé depuis : un écran resté ouvert ne le recrée pas
            e.setdefault("services", {})[k] = s
    elif "services" in recu and (recu.get("services") or {}) != (e.get("services") or {}):
        refus.append("services")

    roles = {r["id"]: r for r in liste(e.get("roles"))}
    for r in liste(recu.get("roles")):
        permis = (sa and r.get("role") in ("admin", "super_admin")) or (r.get("role") == "agent" and r.get("service") in admin_de)
        if not permis:
            if roles.get(r.get("id")) != r:
                refus.append(f"rôle {r.get('code')}")
            continue
        roles[r["id"]] = {**roles[r["id"]], "statut": r.get("statut")} if r["id"] in roles else r
    if not any(r.get("role") == "super_admin" and r.get("statut") == "actif" for r in roles.values()):
        roles = {r["id"]: r for r in liste(e.get("roles"))}  # il doit toujours rester un super admin
        refus.append("dernier super admin")
    e["roles"] = list(roles.values())

    for s, dm in (recu.get("demarches") or {}).items():
        if s in admin_de:
            e.setdefault("demarches", {})[s] = dm

    dossiers = e.setdefault("dossiers", {})
    for k, d in (recu.get("dossiers") or {}).items():
        courant = dossiers.get(k)
        service = (courant or d).get("service")
        if service in agent_de and (not courant or courant.get("service") == d.get("service")):
            if not courant and d.get("iu") == p.iu:
                refus.append(f"{k} (conflit d'intérêts)")
                continue
            nouveau = {c: v for c, v in d.items() if c != "consent"}
            if courant and "consent" in courant:
                nouveau["consent"] = courant["consent"]  # ancien format : conservé tel quel
            dossiers[k] = nouveau
        elif courant and courant.get("iu") == p.iu:
            pass  # espace citoyen en lecture seule : ses écritures sur ses propres dossiers sont ignorées
        elif courant != d:
            refus.append(k)
    return e, refus
