import { ConvexProvider, ConvexReactClient } from "convex/react";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "@livekit/components-styles";
import "./styles.css";
import Home from "./pages/Home";
import SessionPage from "./pages/Session";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConvexProvider client={convex}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/s/:sessionId" element={<SessionPage />} />
        </Routes>
      </BrowserRouter>
    </ConvexProvider>
  </React.StrictMode>,
);
