import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { HomePage } from "./pages/Home";
import { TransactionsPage } from "./pages/Transactions";
import { BudgetsPage } from "./pages/Budgets";
import { ProjectsPage } from "./pages/Projects";
import { TransactionFormPage } from "./pages/TransactionForm";
import { SettingsPage } from "./pages/Settings";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/operations" element={<TransactionsPage />} />
        <Route path="/budgets" element={<BudgetsPage />} />
        <Route path="/projets" element={<ProjectsPage />} />
        <Route path="/reglages/*" element={<SettingsPage />} />
      </Route>
      <Route path="/ajouter" element={<TransactionFormPage />} />
      <Route path="/operation/:id" element={<TransactionFormPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
