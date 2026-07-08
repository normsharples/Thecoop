import { Navigate, Outlet, useLocation } from "react-router-dom";

export default function AdminPage() {
  const location = useLocation();

  if (location.pathname === "/admin" || location.pathname === "/admin/") {
    return <Navigate to="/admin/cash" replace />;
  }

  return <Outlet />;
}
