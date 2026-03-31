import { useState } from "react";
import { supabase } from "../../lib/supabase";

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12S17.4 12 24 12c3 0 5.7 1.1 7.8 3l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 18.9 12 24 12c3 0 5.7 1.1 7.8 3l5.7-5.7C34.1 6.1 29.3 4 24 4c-7.7 0-14.3 4.3-17.7 10.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3c-2 1.5-4.5 2.5-7.3 2.5-5.3 0-9.7-3.3-11.4-8l-6.5 5C9.5 39.5 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.4-2.3 4.4-4.3 5.7l6.3 5.3C36.9 38.6 44 34 44 24c0-1.2-.1-2.3-.4-3.5z" />
    </svg>
  );
}

export default function LoginPage() {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loadingEmail, setLoadingEmail] = useState(false);
  const [loadingGoogle, setLoadingGoogle] = useState(false);
  const [message, setMessage] = useState("");

  async function handleLogin(event) {
    event.preventDefault();
    setLoadingEmail(true);
    setMessage("");

    try {
      if (!email.trim()) {
        throw new Error("Captura un correo electronico valido.");
      }

      if (!password.trim()) {
        throw new Error("Captura una contrasena.");
      }

      if (mode === "register") {
        if (password.length < 6) {
          throw new Error("La contrasena debe tener al menos 6 caracteres.");
        }

        if (password !== confirmPassword) {
          throw new Error("Las contrasenas no coinciden.");
        }

        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: window.location.origin,
          },
        });

        if (error) throw error;

        setMessage("Cuenta creada correctamente. Ya puedes iniciar sesion con tu correo y contrasena.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

        if (error) throw error;

        setMessage("Inicio de sesion correcto.");
      }
    } catch (error) {
      setMessage(`Error: ${error.message}`);
    }

    setLoadingEmail(false);
  }

  async function loginWithGoogle() {
    try {
      setLoadingGoogle(true);
      setMessage("");

      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: window.location.origin,
        },
      });

      if (error) {
        setMessage(`Error Google: ${error.message}`);
      }
    } catch (error) {
      setMessage(`Error Google: ${error.message}`);
    } finally {
      setLoadingGoogle(false);
    }
  }

  return (
    <div style={page}>
      <div style={backgroundGlow} />
      <div style={shell}>
        <section style={heroPanel}>
          <div style={heroBadge}>Portal empresarial</div>
          <h1 style={heroTitle}>Gestion Inteligente de Costos y Presupuestos</h1>
          <p style={heroCopy}>Control total de operaciones en una sola plataforma.</p>

          <div style={heroFeatureList}>
            <div style={featureCard}>
              <strong style={featureTitle}>Operacion comercial</strong>
              <span style={featureCopy}>Cotiza, vende y da seguimiento sin salir del sistema.</span>
            </div>
            <div style={featureCard}>
              <strong style={featureTitle}>Identidad por empresa</strong>
              <span style={featureCopy}>Cada sesion trabaja con su propia marca, clientes y catalogo.</span>
            </div>
          </div>

          <div style={heroFooter}>Creado por GyG Soluciones. Derechos reservados ®</div>
        </section>

        <form onSubmit={handleLogin} style={card}>
          <div style={brandText}>Acceso seguro</div>
          <h2 style={title}>{mode === "register" ? "Crear cuenta" : "Iniciar sesion"}</h2>
          <p style={subtitle}>
            {mode === "register"
              ? "Registra un nuevo acceso con correo y contrasena."
              : "Ingresa con Google o con tu correo y contrasena."}
          </p>

          <div style={modeSwitch}>
            <button
              type="button"
              onClick={() => {
                setMode("login");
                setMessage("");
              }}
              style={{
                ...modeButton,
                ...(mode === "login" ? modeButtonActive : {}),
              }}
            >
              Iniciar sesion
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("register");
                setMessage("");
              }}
              style={{
                ...modeButton,
                ...(mode === "register" ? modeButtonActive : {}),
              }}
            >
              Crear cuenta
            </button>
          </div>

          <button type="button" onClick={loginWithGoogle} style={btnGoogle} disabled={loadingGoogle}>
            <GoogleIcon />
            <span>{loadingGoogle ? "Conectando..." : "Continuar con Google"}</span>
          </button>

          <div style={dividerWrap}>
            <span style={line} />
            <span style={dividerText}>o con correo</span>
            <span style={line} />
          </div>

          <label style={fieldLabel}>Correo electronico</label>
          <input
            type="email"
            placeholder="tu@empresa.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            style={input}
          />

          <label style={fieldLabel}>Contrasena</label>
          <input
            type="password"
            placeholder="Tu contrasena"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            style={input}
          />

          {mode === "register" ? (
            <>
              <label style={fieldLabel}>Confirmar contrasena</label>
              <input
                type="password"
                placeholder="Repite tu contrasena"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
                style={input}
              />
            </>
          ) : null}

          <button type="submit" style={btnPrimary} disabled={loadingEmail}>
            {loadingEmail
              ? mode === "register"
                ? "Creando cuenta..."
                : "Ingresando..."
              : mode === "register"
                ? "Crear cuenta con correo"
                : "Ingresar con correo"}
          </button>

          {message ? <p style={msg}>{message}</p> : null}
        </form>
      </div>
    </div>
  );
}

const page = {
  position: "relative",
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-start",
  padding: "32px",
  background:
    "linear-gradient(120deg, rgba(15, 23, 42, 0.62) 0%, rgba(15, 23, 42, 0.46) 34%, rgba(30, 64, 175, 0.2) 100%), url('/login-bg.jpg') 122% center/cover no-repeat",
  overflow: "hidden",
  fontFamily: "\"Segoe UI\", \"Helvetica Neue\", Arial, sans-serif",
};

const backgroundGlow = {
  position: "absolute",
  width: "520px",
  height: "520px",
  borderRadius: "999px",
  background: "rgba(37, 99, 235, 0.18)",
  filter: "blur(54px)",
  top: "-140px",
  right: "-120px",
};

const shell = {
  position: "relative",
  zIndex: 1,
  width: "min(920px, 100%)",
  display: "grid",
  gridTemplateColumns: "minmax(280px, 0.72fr) minmax(290px, 340px)",
  gap: "16px",
  alignItems: "center",
  marginLeft: "max(2px, 0.6vw)",
};

const heroPanel = {
  display: "grid",
  gap: "14px",
  padding: "24px",
  borderRadius: "30px",
  background: "linear-gradient(145deg, rgba(12, 41, 74, 0.54) 0%, rgba(17, 59, 104, 0.48) 52%, rgba(25, 92, 159, 0.34) 100%)",
  color: "#ffffff",
  boxShadow: "0 28px 50px rgba(15, 23, 42, 0.18)",
  border: "1px solid rgba(255, 255, 255, 0.1)",
  backdropFilter: "blur(12px)",
  minHeight: "500px",
  alignContent: "start",
};

const heroBadge = {
  width: "fit-content",
  padding: "8px 14px",
  borderRadius: "999px",
  background: "rgba(255, 255, 255, 0.14)",
  border: "1px solid rgba(255, 255, 255, 0.18)",
  fontSize: "12px",
  fontWeight: 800,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

const heroTitle = {
  margin: 0,
  fontSize: "clamp(20px, 2.2vw, 30px)",
  lineHeight: 1.08,
  fontWeight: 900,
  maxWidth: "360px",
  fontFamily: "\"Georgia\", \"Times New Roman\", serif",
  letterSpacing: "-0.03em",
};

const heroCopy = {
  margin: 0,
  maxWidth: "320px",
  color: "rgba(255, 255, 255, 0.82)",
  fontSize: "14px",
  lineHeight: 1.45,
  fontFamily: "\"Segoe UI\", \"Helvetica Neue\", Arial, sans-serif",
};

const heroFeatureList = {
  display: "grid",
  gridTemplateColumns: "1fr",
  gap: "10px",
  marginTop: "4px",
};

const featureCard = {
  display: "grid",
  gap: "4px",
  padding: "12px",
  borderRadius: "18px",
  background: "rgba(255, 255, 255, 0.1)",
  border: "1px solid rgba(255, 255, 255, 0.14)",
  backdropFilter: "blur(8px)",
};

const featureTitle = {
  fontSize: "14px",
  fontWeight: 800,
  fontFamily: "\"Georgia\", \"Times New Roman\", serif",
};

const featureCopy = {
  color: "rgba(255, 255, 255, 0.78)",
  fontSize: "13px",
  lineHeight: 1.4,
};

const heroFooter = {
  marginTop: "auto",
  color: "rgba(255, 255, 255, 0.76)",
  fontSize: "14px",
  fontWeight: 700,
};

const card = {
  background: "linear-gradient(145deg, rgba(12, 41, 74, 0.54) 0%, rgba(17, 59, 104, 0.48) 52%, rgba(25, 92, 159, 0.34) 100%)",
  padding: "22px",
  borderRadius: "28px",
  display: "flex",
  flexDirection: "column",
  gap: "10px",
  boxShadow: "0 22px 44px rgba(15, 23, 42, 0.12)",
  border: "1px solid rgba(255, 255, 255, 0.26)",
  alignSelf: "stretch",
  backdropFilter: "blur(14px)",
  maxWidth: "316px",
  minHeight: "500px",
  justifyContent: "flex-start",
};

const brandText = {
  color: "#dbeafe",
  fontSize: "13px",
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  marginTop: "2px",
};

const title = {
  margin: "2px 0 0",
  color: "#ffffff",
  fontSize: "25px",
  lineHeight: 1.1,
  fontFamily: "\"Georgia\", \"Times New Roman\", serif",
  letterSpacing: "-0.02em",
};

const subtitle = {
  margin: "0 0 6px",
  color: "rgba(255, 255, 255, 0.82)",
  fontSize: "13px",
  lineHeight: 1.5,
  fontFamily: "\"Segoe UI\", \"Helvetica Neue\", Arial, sans-serif",
};

const fieldLabel = {
  color: "#e2e8f0",
  fontSize: "13px",
  fontWeight: 700,
};

const input = {
  padding: "14px 16px",
  borderRadius: "14px",
  border: "1px solid rgba(148, 163, 184, 0.4)",
  fontSize: "14px",
  outline: "none",
  background: "rgba(255, 255, 255, 0.58)",
};

const btnPrimary = {
  padding: "13px 16px",
  borderRadius: "14px",
  background: "linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%)",
  color: "#0b2545",
  border: "1px solid rgba(255, 255, 255, 0.36)",
  cursor: "pointer",
  fontWeight: 800,
  fontSize: "14px",
  boxShadow: "0 14px 24px rgba(15, 23, 42, 0.18)",
};

const btnGoogle = {
  padding: "13px 16px",
  borderRadius: "14px",
  background: "rgba(255, 255, 255, 0.16)",
  color: "#fff",
  border: "1px solid rgba(255, 255, 255, 0.24)",
  cursor: "pointer",
  fontWeight: 800,
  fontSize: "14px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "10px",
};

const dividerWrap = {
  display: "flex",
  alignItems: "center",
  gap: "10px",
  margin: "4px 0",
};

const line = {
  flex: 1,
  height: "1px",
  background: "#e2e8f0",
};

const dividerText = {
  color: "rgba(255, 255, 255, 0.76)",
  fontSize: "13px",
  fontWeight: 600,
};

const msg = {
  margin: 0,
  color: "#eff6ff",
  fontSize: "14px",
  lineHeight: 1.5,
  background: "rgba(255, 255, 255, 0.12)",
  border: "1px solid rgba(255, 255, 255, 0.16)",
  borderRadius: "14px",
  padding: "12px 14px",
};

const modeSwitch = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "8px",
  marginBottom: "2px",
};

const modeButton = {
  padding: "11px 12px",
  borderRadius: "14px",
  border: "1px solid rgba(255, 255, 255, 0.16)",
  background: "rgba(255, 255, 255, 0.08)",
  color: "#e2e8f0",
  cursor: "pointer",
  fontWeight: 700,
  fontSize: "13px",
};

const modeButtonActive = {
  background: "rgba(219, 234, 254, 0.92)",
  color: "#0b2545",
  border: "1px solid rgba(255, 255, 255, 0.32)",
};
