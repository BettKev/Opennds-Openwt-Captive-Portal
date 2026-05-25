import React, { useState, useEffect } from 'react';
import LoginCard from './components/LoginCard';
import WaitingCard from './components/WaitingCard';
import './styles.css'; // Importing your dedicated CSS architecture

export interface Package {
  id: string;
  name: string;
  amount: number;
  download_rate?: number; 
  duration_hours: number;
}

const App: React.FC = () => {
  const [checkoutId, setCheckoutId] = useState<string | null>(null);
  const [macAddress, setMacAddress] = useState<string>('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setMacAddress(params.get('mac') || '');
  }, []);

  return (
    <div className="app-container" id="app-root-view">
      {!checkoutId ? (
        <LoginCard 
          macAddress={macAddress} 
          onPaymentInitiated={(id) => setCheckoutId(id)} 
        />
      ) : (
        <WaitingCard checkoutId={checkoutId} />
      )}
    </div>
  );
};

export default App;