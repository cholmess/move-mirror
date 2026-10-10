import { NavLink, Outlet } from "react-router-dom";
import { PRODUCT_TAGLINE } from "../data/constants";
import { useApp } from "../context/AppContext";

const links = [
  { to: "/", label: "Dashboard" },
  { to: "/lesson", label: "Microlección" },
  { to: "/train", label: "Entrenar" },
  { to: "/defense", label: "Defense Lab" },
  { to: "/profile", label: "Perfil" },
  { to: "/transfer", label: "Transferencia" },
];

export function Layout() {
  const { state } = useApp();

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-name">MoveMirror</span>
          <span className="brand-tag">{PRODUCT_TAGLINE}</span>
        </div>
        <nav className="nav">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
              end={l.to === "/"}
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="header-meta">
          <span className="mono">{state.username}</span>
        </div>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
