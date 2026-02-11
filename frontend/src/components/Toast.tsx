import { motion, AnimatePresence } from "framer-motion";
import { X, CheckCircle, AlertTriangle, Info } from "lucide-react";
import { useEffect } from "react";

export interface ToastMessage {
  id: string;
  type: "success" | "error" | "info";
  message: string;
}

interface Props {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

const icons = {
  success: <CheckCircle size={14} className="text-success shrink-0" />,
  error: <AlertTriangle size={14} className="text-error shrink-0" />,
  info: <Info size={14} className="text-info shrink-0" />,
};

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: ToastMessage;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 5000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      className="flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-lg text-sm max-w-sm"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--bg-border)",
      }}
    >
      {icons[toast.type]}
      <span className="text-text-primary flex-1">{toast.message}</span>
      <button
        onClick={onDismiss}
        className="p-0.5 rounded hover:bg-bg-dark text-text-tertiary cursor-pointer border-none bg-transparent"
      >
        <X size={12} />
      </button>
    </motion.div>
  );
}

export function ToastContainer({ toasts, onDismiss }: Props) {
  return (
    <div className="fixed bottom-16 right-4 z-[200] flex flex-col gap-2">
      <AnimatePresence>
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
        ))}
      </AnimatePresence>
    </div>
  );
}
