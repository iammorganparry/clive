import React from 'react';
import { ThemeContext, oneDarkPro, type Theme } from '../theme.js';

interface ThemeProviderProps {
  theme?: Theme;
  children: React.ReactNode;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({
  theme = oneDarkPro,
  children,
}) => {
  return (
    <ThemeContext.Provider value={theme}>
      {children}
    </ThemeContext.Provider>
  );
};
