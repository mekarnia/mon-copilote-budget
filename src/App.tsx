import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { Layout } from "./components/Layout";
import { HomePage } from "./pages/Home";
import { TransactionsPage } from "./pages/Transactions";
import { TransactionFormPage } from "./pages/TransactionForm";

// Les trois écrans du geste quotidien — voir, lister, ajouter — sont dans le
// premier fichier chargé. Les autres arrivent quand on y va : sur un téléphone
// en 3G, l'ouverture de l'application ne doit pas payer l'écran des réglages.
const BudgetsPage = lazy(() => import("./pages/Budgets").then((m) => ({ default: m.BudgetsPage })));
const ProjectsPage = lazy(() => import("./pages/Projects").then((m) => ({ default: m.ProjectsPage })));
const SettingsPage = lazy(() => import("./pages/Settings").then((m) => ({ default: m.SettingsPage })));
const CoachPage = lazy(() => import("./pages/Coach").then((m) => ({ default: m.CoachPage })));
const SuiviPage = lazy(() => import("./pages/Suivi").then((m) => ({ default: m.SuiviPage })));
const SuiviCategoriePage = lazy(() => import("./pages/SuiviCategorie").then((m) => ({ default: m.SuiviCategoriePage })));
const VerifierPage = lazy(() => import("./pages/Verifier").then((m) => ({ default: m.VerifierPage })));

/** Le temps qu'un écran arrive : un vide, pas un message. Il dure quelques centièmes. */
const Attente = () => <div className="p-4" aria-busy="true" />;

/** Ancienne adresse d'une transaction : redirection pour les favoris déjà enregistrés. */
function RedirectOperation() {
  const { id } = useParams();
  return <Navigate to={`/transaction/${id}`} replace />;
}

export default function App() {
  return (
    <Suspense fallback={<Attente />}>
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
    </Suspense>
  );
}
