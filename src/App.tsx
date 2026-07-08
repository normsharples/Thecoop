import { lazy } from "react";
import { createBrowserRouter, RouterProvider, Navigate } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";

const LoginPage = lazy(() => import("@/pages/LoginPage"));
const DashboardPage = lazy(() => import("@/pages/DashboardPage"));
const ReportsPage = lazy(() => import("@/pages/ReportsPage"));
const LeaderboardPage = lazy(() => import("@/pages/LeaderboardPage"));
const StockCountsPage = lazy(() => import("@/pages/StockCountsPage"));
const MaintenancePage = lazy(() => import("@/pages/MaintenancePage"));
const AdminPage = lazy(() => import("@/pages/AdminPage"));
const CashDepositsPage = lazy(() => import("@/pages/CashDepositsPage"));
const InvoicesPage = lazy(() => import("@/pages/InvoicesPage"));
const ExpensesPage = lazy(() => import("@/pages/ExpensesPage"));
const PurchaseOrdersPage = lazy(() => import("@/pages/PurchaseOrdersPage"));
const IncidentsPage = lazy(() => import("@/pages/IncidentsPage"));
const WHSAuditsPage = lazy(() => import("@/pages/WHSAuditsPage"));
const CalendarPage = lazy(() => import("@/pages/CalendarPage"));
const DrivePage = lazy(() => import("@/pages/DrivePage"));
const StoreProfilesPage = lazy(() => import("@/pages/StoreProfilesPage"));
const ProjectionsPage = lazy(() => import("@/pages/ProjectionsPage"));
const SettingsPage = lazy(() => import("@/pages/SettingsPage"));

const SalesReport = lazy(() => import("@/components/reports/SalesReport"));
const LabourReport = lazy(() => import("@/components/reports/LabourReport"));
const ReviewsReport = lazy(() => import("@/components/reports/ReviewsReport"));
const FoodCostReport = lazy(() => import("@/components/reports/FoodCostReport"));
const PnLReport = lazy(() => import("@/components/reports/PnLReport"));
const SalesRecordsReport = lazy(() => import("@/components/reports/SalesRecordsReport"));
const CashUpsReport = lazy(() => import("@/components/reports/CashUpsReport"));

const TeamSettings = lazy(() => import("@/components/settings/TeamSettings"));
const QuickLinksSettings = lazy(() => import("@/components/settings/QuickLinksSettings"));
const TargetsSettings = lazy(() => import("@/components/settings/TargetsSettings"));
const AlertSettings = lazy(() => import("@/components/settings/AlertSettings"));
const WHSAuditTemplates = lazy(() => import("@/components/settings/WHSAuditTemplates"));
const FoodCostSettings = lazy(() => import("@/components/settings/FoodCostSettings"));
const FoodCostItems = lazy(() => import("@/components/settings/FoodCostItems"));
const StockCountSettings = lazy(() => import("@/components/settings/StockCountSettings"));
const RecipesSettings = lazy(() => import("@/components/settings/RecipesSettings"));
const AssetRegister = lazy(() => import("@/components/settings/AssetRegister"));
const BankAccounts = lazy(() => import("@/components/settings/BankAccounts"));
const IntegrationsSettings = lazy(() => import("@/components/settings/IntegrationsSettings"));

const SalesManualEntryPage = lazy(() => import("@/pages/SalesManualEntryPage"));
const LabourManualEntryPage = lazy(() => import("@/pages/LabourManualEntryPage"));

const router = createBrowserRouter([
  {
    path: "/login",
    element: <LoginPage />,
  },
  {
    element: <AppLayout />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "calendar", element: <CalendarPage /> },
      { path: "reports/sales/manual-entry", element: <SalesManualEntryPage /> },
      { path: "reports/labour/manual-entry", element: <LabourManualEntryPage /> },
      {
        path: "reports",
        element: <ReportsPage />,
        children: [
          { index: true, element: <Navigate to="sales" replace /> },
          { path: "sales", element: <SalesReport /> },
          { path: "labour", element: <LabourReport /> },
          { path: "reviews", element: <ReviewsReport /> },
          { path: "food-cost", element: <FoodCostReport /> },
          { path: "pnl", element: <PnLReport /> },
          { path: "records", element: <SalesRecordsReport /> },
          { path: "cash-ups", element: <CashUpsReport /> },
        ],
      },
      { path: "leaderboard", element: <LeaderboardPage /> },
      {
        path: "admin",
        element: <AdminPage />,
        children: [
          { index: true, element: <Navigate to="cash" replace /> },
          { path: "cash", element: <CashDepositsPage /> },
          { path: "invoices", element: <InvoicesPage /> },
          { path: "expenses", element: <ExpensesPage /> },
          { path: "purchase-orders", element: <PurchaseOrdersPage /> },
          { path: "stock-counts", element: <StockCountsPage /> },
          { path: "maintenance", element: <MaintenancePage /> },
          { path: "incidents", element: <IncidentsPage /> },
          { path: "whs-audits", element: <WHSAuditsPage /> },
          { path: "drive", element: <DrivePage /> },
          { path: "store-profiles", element: <StoreProfilesPage /> },
          { path: "projections", element: <ProjectionsPage /> },
          {
            path: "settings",
            element: <SettingsPage />,
            children: [
              { index: true, element: <Navigate to="team" replace /> },
              { path: "team", element: <TeamSettings /> },
              { path: "targets", element: <TargetsSettings /> },
              { path: "alerts", element: <AlertSettings /> },
              { path: "whs-templates", element: <WHSAuditTemplates /> },
              { path: "food-cost", element: <FoodCostSettings /> },
              { path: "food-cost-items", element: <FoodCostItems /> },
              { path: "stock-counts", element: <StockCountSettings /> },
              { path: "recipes", element: <RecipesSettings /> },
              { path: "asset-register", element: <AssetRegister /> },
              { path: "bank-accounts", element: <BankAccounts /> },
              { path: "quick-links", element: <QuickLinksSettings /> },
              { path: "integrations", element: <IntegrationsSettings /> },
            ],
          },
        ],
      },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
