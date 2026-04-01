import {
  Home,
  Users,
  Package,
  Boxes,
  Truck,
  BadgeDollarSign,
  FileText,
  ShoppingCart,
  BarChart3,
  ShieldCheck,
  Settings,
} from "lucide-react";
import { NavLink } from "react-router-dom";
import "./layout.css";

export default function Sidebar({ company, branding, isSuperAdmin }) {
  const companyName = branding?.business_name || company?.name || "Tu empresa";
  const companyInitials = companyName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((value) => value[0])
    .join("")
    .toUpperCase();
  const logoUrl = branding?.logo_url || company?.logo_url || "";
  const accentColor = branding?.primary_color || company?.primary_color || "#2563eb";

  return (
    <aside className="sidebar" style={{ "--brand-accent": accentColor }}>
      <div className="sidebar-brand">
        <div className="sidebar-brand-mark">
          {logoUrl ? (
            <img src={logoUrl} alt={companyName} className="sidebar-brand-image" />
          ) : (
            <span>{companyInitials || "GY"}</span>
          )}
        </div>

        <div>
          <h2 className="logo">{companyName}</h2>
          <p className="sidebar-brand-copy">{company?.business_type || "general"}</p>
        </div>
      </div>

      <nav>
        <NavLink to="/dashboard" className="nav-link">
          <Home size={18} />
          Dashboard
        </NavLink>

        <NavLink to="/clientes" className="nav-link">
          <Users size={18} />
          Clientes
        </NavLink>

        <NavLink to="/productos" className="nav-link">
          <Package size={18} />
          Productos
        </NavLink>

        <NavLink to="/inventario" className="nav-link">
          <Boxes size={18} />
          Inventario
        </NavLink>

        <NavLink to="/proveedores" className="nav-link">
          <Truck size={18} />
          Proveedores
        </NavLink>

        <NavLink to="/vendedores" className="nav-link">
          <BadgeDollarSign size={18} />
          Vendedores
        </NavLink>

        <NavLink to="/cotizaciones" className="nav-link">
          <FileText size={18} />
          Cotizaciones
        </NavLink>

        <NavLink to="/punto-venta" className="nav-link">
          <ShoppingCart size={18} />
          Punto de Venta
        </NavLink>

        <NavLink to="/reportes" className="nav-link">
          <BarChart3 size={18} />
          Reportes
        </NavLink>

        {isSuperAdmin ? (
          <NavLink to="/administracion" className="nav-link nav-link-admin">
            <ShieldCheck size={18} />
            Administracion
          </NavLink>
        ) : null}

        <NavLink to="/configuracion" className="nav-link">
          <Settings size={18} />
          Configuracion
        </NavLink>
      </nav>
    </aside>
  );
}
