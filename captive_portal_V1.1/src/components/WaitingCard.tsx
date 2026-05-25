import React, { useState, useEffect } from 'react';

interface WaitingCardProps {
  checkoutId: string;
}

const WaitingCard: React.FC<WaitingCardProps> = ({ checkoutId }) => {
  const [adIndex, setAdIndex] = useState<number>(0);
  const [statusText, setStatusText] = useState<string>('Verifying Payment');
  const [subText, setSubText] = useState<string>('Enter your M-Pesa PIN on your phone to complete connection.');
  const [isConnected, setIsConnected] = useState<boolean>(false);

  const ads = [
    { title: 'Fast Printing', body: 'Color prints available now.' },
    { title: 'Cyber Services', body: 'KRA & e-Citizen services.' }
  ];

  useEffect(() => {
    const slideInterval = setInterval(() => {
      setAdIndex((prev) => (prev + 1) % ads.length);
    }, 3000);
    return () => clearInterval(slideInterval);
  }, [ads.length]);

  useEffect(() => {
    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`/status?id=${encodeURIComponent(checkoutId)}`);
        const data = await response.json();

        if (data.status === 'PAID' && data.processed === 1) {
          clearInterval(pollInterval);
          setIsConnected(true);
          setStatusText('Connected!');
          setSubText('Redirecting you now...');
          
          if ('speechSynthesis' in window) {
            window.speechSynthesis.speak(new SpeechSynthesisUtterance('Connected. Welcome to B.H.S WiFi'));
          }

          setTimeout(() => {
            window.location.href = 'http://connectivitycheck.gstatic.com/generate_204';
          }, 2500);
        }
      } catch (err) {
        console.error('Status synchronization variance tracked:', err);
      }
    }, 2500);

    return () => clearInterval(pollInterval);
  }, [checkoutId]);

  return (
    <div className="waiting-card" id="transaction-waiting-card">
      {!isConnected && <div className="loading-spinner" id="polling-indicator" />}
      
      <div 
        className="status-header" 
        style={{ color: isConnected ? '#2ecc71' : '#ffffff' }}
      >
        {statusText}
      </div>
      <p className="status-subtext">{subText}</p>
      
      <div className="billboard-container">
        {ads.map((ad, i) => (
          <div 
            key={i} 
            className={`ad-slide ${i === adIndex ? 'visible' : ''}`}
          >
            <strong>{ad.title}</strong><br />{ad.body}
          </div>
        ))}
      </div>
    </div>
  );
};

export default WaitingCard;