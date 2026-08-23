import { lazy } from "react";
import { createBrowserRouter, RouterProvider, Navigate } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";

const LoginPage = lazy(() => import("@/pages/LoginPage"));
const DashboardPage = lazy(() => import("@/pages/DashboardPage"));
const PulsePage = lazy(() => import("@/pages/PulsePage"));
const ReportsPage = lazy(() => import("@/pages/ReportsPage"));
const LeaderboardPage = lazy(() => import("@/pages/LeaderboardPage"));
const StockCountsPage = lazy(() => import("@/pages/StockCountsPage"));
const MaintenancePage = lazy(() => import("@/pages/MaintenancePage"));
const AdminPage = lazy(() => import("@/pages/AdminPage"));
const CashDepositsPage = lazy(() => import("@/pages/CashDepositsPage"));
const InvoicesPage = lazy(() => import("@/pages/InvoicesPage"));
const InventoryPage = lazy(() => import("@/pages/InventoryPage"));
const WastePage = lazy(() => import("@/pages/WastePage"));
const TransfersPage = lazy(() => import("@/pages/TransfersPage"));
const ExpensesPage = lazy(() => import("@/pages/ExpensesPage"));
const PurchaseOrdersPage = lazy(() => import("@/pages/PurchaseOrdersPage"));
const IncidentsPage = lazy(() => import("@/pages/IncidentsPage"));
const WHSAuditsPage = lazy(() => import("@/pages/WHSAuditsPage"));
const CalendarPage = lazy(() => import("@/pages/CalendarPage"));
const DrivePage = lazy(() => import("@/pages/DrivePage"));
const StoreProfilesPage = lazy(() => import("@/pages/StoreProfilesPage"));
const ProjectionsPage = lazy(() => import("@/pages/ProjectionsPage"));
const RosteringPage = lazy(() => import("@/pages/RosteringPage"));
const MyRosterPage = lazy(() => import("@/pages/MyRosterPage"));
const RosterViewPage = lazy(() => import("@/pages/RosterViewPage"));
const MyAvailabilityPage = lazy(() => import("@/pages/MyAvailabilityPage"));
const TeamPage = lazy(() => import("@/pages/TeamPage"));
const FoodPage = lazy(() => import("@/pages/FoodPage"));
const KioskPage = lazy(() => import("@/pages/KioskPage"));
const OnboardingPage = lazy(() => import("@/pages/OnboardingPage"));
const ClockPage = lazy(() => import("@/pages/ClockPage"));
const MyProfilePage = lazy(() => import("@/pages/MyProfilePage"));
const SettingsPage = lazy(() => import("@/pages/SettingsPage"));

const SalesReport = lazy(() => import("@/components/reports/SalesReport"));
const SalesReportLayout = lazy(() => import("@/components/reports/SalesReportLayout"));
const SalesByHourReport = lazy(() => import("@/components/reports/SalesByHourReport"));
const LabourReport = lazy(() => import("@/components/reports/LabourReport"));
const RosterDashboard = lazy(() => import("@/components/reports/RosterDashboard"));
const ReviewsReport = lazy(() => import("@/components/reports/ReviewsReport"));
const FoodCostReport = lazy(() => import("@/components/reports/FoodCostReport"));
const FoodUsageReport = lazy(() => import("@/components/reports/FoodUsageReport"));
const TransfersReport = lazy(() => import("@/components/reports/TransfersReport"));
const PnLReport = lazy(() => import("@/components/reports/PnLReport"));
const SalesRecordsReport = lazy(() => import("@/components/reports/SalesRecordsReport"));
const CashUpsReport = lazy(() => import("@/components/reports/CashUpsReport"));
const PayoutReport = lazy(() => import("@/components/reports/PayoutReport"));
const EmployeeContactReport = lazy(() => import("@/components/reports/EmployeeContactReport"));

const QuickLinksSettings = lazy(() => import("@/components/settings/QuickLinksSettings"));
const TargetsSettings = lazy(() => import("@/components/settings/TargetsSettings"));
const PositionsSettings = lazy(() => import("@/components/settings/PositionsSettings"));
const StaffingSettings = lazy(() => import("@/components/settings/StaffingSettings"));
const RosterCheckSettings = lazy(() => import("@/components/settings/RosterCheckSettings"));
const AlertSettings = lazy(() => import("@/components/settings/AlertSettings"));
const WHSAuditTemplates = lazy(() => import("@/components/settings/WHSAuditTemplates"));
const FoodCostSettings = lazy(() => import("@/components/settings/FoodCostSettings"));
const FoodCostItems = lazy(() => import("@/components/settings/FoodCostItems"));
const StockCountSettings = lazy(() => import("@/components/settings/StockCountSettings"));
const RecipesSettings = lazy(() => import("@/components/settings/RecipesSettings"));
const AssetRegister = lazy(() => import("@/components/settings/AssetRegister"));
const BankAccounts = lazy(() => import("@/components/settings/BankAccounts"));
const IntegrationsSettings = lazy(() => import("@/components/settings/IntegrationsSettings"));
const BrandsSettings = lazy(() => import("@/components/settings/BrandsSettings"));
const VenuesSettings = lazy(() => import("@/components/settings/VenuesSettings"));
const OrderingScheduleSettings = lazy(() => import("@/components/settings/OrderingScheduleSettings"));
const TasksPage = lazy(() => import("@/pages/TasksPage"));

const SalesManualEntryPage = lazy(() => import("@/pages/SalesManualEntryPage"));
const LabourManualEntryPage = lazy(() => import("@/pages/LabourManualEntryPage"));
const DataManagementPage = lazy(() => import("@/pages/DataManagementPage"));

const router = createBrowserRouter([
  {
    path: "/login",
    element: <LoginPage />,
  },
  {
    // Full-screen shared-tablet time clock (its own chrome, outside AppLayout).
    path: "/kiosk",
    element: <KioskPage />,
  },
  {
    // Onboarding wizard — full screen, outside AppLayout so the gate can send
    // people here without the nav chrome.
    path: "/onboarding",
    element: <OnboardingPage />,
  },
  {
    // Clock in/out, reachable even while onboarding is incomplete. Nobody
    // works unpaid because of paperwork.
    path: "/clock",
    element: <ClockPage />,
  },
  {
    element: <AppLayout />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "pulse", element: <PulsePage /> },
      { path: "tasks", element: <TasksPage /> },
      { path: "rostering", element: <RosteringPage /> },
      { path: "my-roster", element: <MyRosterPage /> },
      { path: "roster-view", element: <RosterViewPage /> },
      { path: "my-availability", element: <MyAvailabilityPage /> },
      { path: "my-profile", element: <MyProfilePage /> },
      { path: "calendar", element: <CalendarPage /> },
      { path: "reports/sales/manual-entry", element: <SalesManualEntryPage /> },
      { path: "reports/labour/manual-entry", element: <LabourManualEntryPage /> },
      {
        path: "reports",
        element: <ReportsPage />,
        children: [
          { index: true, element: <Navigate to="sales" replace /> },
          {
            path: "sales",
            element: <SalesReportLayout />,
            children: [
              { index: true, element: <SalesReport /> },
              { path: "by-hour", element: <SalesByHourReport /> },
            ],
          },
          { path: "labour", element: <LabourReport /> },
          { path: "roster", element: <RosterDashboard /> },
          { path: "reviews", element: <ReviewsReport /> },
          { path: "food-cost", element: <FoodCostReport /> },
          { path: "food-usage", element: <FoodUsageReport /> },
          { path: "transfers", element: <TransfersReport /> },
          { path: "pnl", element: <PnLReport /> },
          { path: "records", element: <SalesRecordsReport /> },
          { path: "cash-ups", element: <CashUpsReport /> },
          { path: "payouts", element: <PayoutReport /> },
          { path: "contacts", element: <EmployeeContactReport /> },
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
          { path: "data-management", element: <DataManagementPage /> },
          { path: "purchase-orders", element: <PurchaseOrdersPage /> },
          { path: "inventory", element: <InventoryPage /> },
          { path: "transfers", element: <TransfersPage /> },
          { path: "waste", element: <WastePage /> },
          { path: "stock-counts", element: <StockCountsPage /> },
          { path: "maintenance", element: <MaintenancePage /> },
          { path: "incidents", element: <IncidentsPage /> },
          { path: "whs-audits", element: <WHSAuditsPage /> },
          { path: "drive", element: <DrivePage /> },
          { path: "store-profiles", element: <StoreProfilesPage /> },
          { path: "projections", element: <ProjectionsPage /> },
          { path: "team", element: <TeamPage /> },
          {
            path: "food",
            element: <FoodPage />,
            children: [
              { index: true, element: <Navigate to="purchase-orders" replace /> },
              { path: "purchase-orders", element: <PurchaseOrdersPage /> },
              { path: "invoices", element: <InvoicesPage /> },
              { path: "transfers", element: <TransfersPage /> },
              { path: "inventory", element: <InventoryPage /> },
              { path: "waste", element: <WastePage /> },
              { path: "stock-counts", element: <StockCountsPage /> },
            ],
          },
          {
            path: "settings",
            element: <SettingsPage />,
            children: [
              { index: true, element: <Navigate to="venues" replace /> },
              { path: "venues", element: <VenuesSettings /> },
              { path: "brands", element: <BrandsSettings /> },
              { path: "ordering-schedule", element: <OrderingScheduleSettings /> },
              { path: "positions", element: <PositionsSettings /> },
              { path: "staffing", element: <StaffingSettings /> },
              { path: "roster-checks", element: <RosterCheckSettings /> },
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
