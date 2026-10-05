import {
  Fragment,
  createContext,
  useContext,
  useState,
  type ReactNode,
} from 'react';
import { ALL_PORTFOLIOS } from '@shared/portfolio-account.ts';

const Context = createContext<{
  selectedId: string;
  select: (id: string) => void;
} | null>(null);
/** Lives only inside the unlocked vault. Lock/sign-out drops selection and all decrypted screen state. */
export function PortfolioSelectionProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [selectedId, select] = useState(ALL_PORTFOLIOS);
  return (
    <Context.Provider value={{ selectedId, select }}>
      <Fragment key={selectedId}>{children}</Fragment>
    </Context.Provider>
  );
}
export function usePortfolioSelection() {
  const value = useContext(Context);
  if (!value)
    throw new Error('Portfolio selection requires an unlocked vault.');
  return value;
}
