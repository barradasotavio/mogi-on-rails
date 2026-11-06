import { Tracker } from "@/components/tracker";
import { ToastProvider } from "@/components/ui/toast";
export default function Home() {
  return (
    <ToastProvider>
      <Tracker />
    </ToastProvider>
  );
}
