import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import "./layout.css";

export default function AppLayout({ children, userEmail, onLogout, company, branding, isSuperAdmin }) {
  return (
    <div className="app">
      <Sidebar company={company} branding={branding} isSuperAdmin={isSuperAdmin} />
      <main className="main">
        <Topbar
          userEmail={userEmail}
          onLoggedOut={onLogout}
          company={company}
          branding={branding}
        />
        <section className="content">{children}</section>
      </main>
    </div>
  );
}
