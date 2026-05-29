import "leaflet/dist/leaflet.css";
import { AtlasStage } from "@/components/auth/atlas-stage";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <AtlasStage>{children}</AtlasStage>;
}
