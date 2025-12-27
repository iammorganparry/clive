import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useState,
} from "react";

export type ComparisonMode = "branch" | "uncommitted";

interface ComparisonModeContextType {
  mode: ComparisonMode;
  setMode: (mode: ComparisonMode) => void;
}

const ComparisonModeContext = createContext<
  ComparisonModeContextType | undefined
>(undefined);

interface ComparisonModeProviderProps {
  children: ReactNode;
}

export const ComparisonModeProvider = ({
  children,
}: ComparisonModeProviderProps) => {
  const [mode, setModeState] = useState<ComparisonMode>("branch");

  const setMode = useCallback((newMode: ComparisonMode) => {
    setModeState(newMode);
  }, []);

  const value: ComparisonModeContextType = {
    mode,
    setMode,
  };

  return (
    <ComparisonModeContext.Provider value={value}>
      {children}
    </ComparisonModeContext.Provider>
  );
};

export const useComparisonMode = (): ComparisonModeContextType => {
  const context = useContext(ComparisonModeContext);
  if (context === undefined) {
    throw new Error(
      "useComparisonMode must be used within a ComparisonModeProvider",
    );
  }
  return context;
};

