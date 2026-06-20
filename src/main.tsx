import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import PetWindow from "./components/pet/PetWindow";

const isPetWindow = new URLSearchParams(window.location.search).get('window') === 'pet';

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isPetWindow ? <PetWindow /> : <App />}
  </React.StrictMode>,
);
