import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { Layout } from "./components/Layout";
import { HomePage } from "./pages/Home";
import { TransactionsPage } from "./pages/Transactions";
import { BudgetsPage } from "./pages/Budgets";
import { ProjectsPage } from "./pages/Projects";
import { TransactionFormPage } from "./pages/TransactionForm";
import { SettingsPage } from "./pages/Settings";
import { CoachPage } from "./pages/Coach";
import { SuiviPage } from "./pages/Suivi";
import { SuiviCategoriePage } from "./pages/SuiviCategorie";
import { VerifierPage } from "./pages/Verifier";

/** Ancienne adresse d'une transaction : redirection pour les favoris déjà enregistrés. */
function RedirectOperation() {
  const { id } = useParams();
  return <Navigate to={`/transaction/${id}`} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/transactions" element={<TransactionsPage />} />
        <Route path="/verifier" element={<VerifierPage />} />
        <Route path="/budgets" element={<BudgetsPage />} />
        <Route path="/projets" element={<ProjectsPage />} />
        <Route path="/suivi" element={<SuiviPage />} />
        <Route path="/suivi/categorie/:id" element={<SuiviCategoriePage />} />
        <Route path="/reglages/*" element={<SettingsPage />} />
      </Route>
      <Route path="/ajouter" element={<TransactionFormPage />} />
      <Route path="/coach" element={<CoachPage />} />
      <Route path="/transaction/:id" element={<TransactionFormPage />} />
      {/* Anciennes adresses, conservées pour les favoris et les raccourcis déjà enregistrés. */}
      <Route path="/operations" element={<Navigate to="/transactions" replace />} />
      <Route path="/operation/:id" element={<RedirectOperation />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
