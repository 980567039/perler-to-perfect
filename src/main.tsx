import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { isRedinkAutoMode } from './integrations/redinkAutoBridge';
import './styles.css';

const root = createRoot(document.getElementById('root')!);

if (isRedinkAutoMode()) {
  void import('./AutoMode').then(({ AutoMode }) => root.render(<AutoMode />));
} else {
  void import('./App').then(({ App }) =>
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    ),
  );
}
