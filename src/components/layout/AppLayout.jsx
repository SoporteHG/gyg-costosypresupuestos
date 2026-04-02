import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import "./layout.css";

export default function AppLayout({
  children,
  userEmail,
  onLogout,
  company,
  branding,
  isSuperAdmin,
  themeMode,
  onToggleTheme,
}) {
  return (
    <div className={`app ${themeMode === "dark" ? "app-theme-dark" : ""}`}>
      <Sidebar company={company} branding={branding} isSuperAdmin={isSuperAdmin} />
      <main className="main">
        <Topbar
          userEmail={userEmail}
          onLoggedOut={onLogout}
          company={company}
          branding={branding}
          themeMode={themeMode}
          onToggleTheme={onToggleTheme}
        />
        <section className="content">{children}</section>
      </main>
    </div>
  );
}
