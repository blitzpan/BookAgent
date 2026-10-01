import React from 'react';

interface LoaderProps {
  message: string;
}

const Loader: React.FC<LoaderProps> = ({ message }) => {
  return (
    <div className="flex flex-col items-center justify-center text-center p-8 bg-stone-100/80 dark:bg-stone-800/80 rounded-lg shadow-lg">
      <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-brand mb-6"></div>
      <h2 className="text-2xl font-bold text-stone-800 dark:text-stone-200 mb-2">Generating Your Masterpiece...</h2>
      <p className="text-lg text-[#9c4a2c] dark:text-[#e8b15a] font-semibold">{message}</p>
    </div>
  );
};

export default Loader;
