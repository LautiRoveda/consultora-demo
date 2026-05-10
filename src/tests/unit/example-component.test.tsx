import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

function Greeting({ name }: { name: string }) {
  return <h1>Hola, {name}</h1>;
}

describe('Greeting', () => {
  it('renderiza el saludo con el nombre dado', () => {
    render(<Greeting name="ConsultoraDemo" />);
    expect(screen.getByRole('heading', { name: /Hola, ConsultoraDemo/i })).toBeInTheDocument();
  });
});
