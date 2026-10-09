type Tarefa = () => void;

/**
 * Fila que segura o ritmo das chamadas.
 *
 * Não é otimização, é obrigação. O Bling permite 3 chamadas por segundo e
 * responde 429 acima disso; passando do ponto com frequência, ele bloqueia o
 * **IP de origem** por 10 minutos. O castigo atinge todo mundo que sai por
 * aquele IP, não só a integração que abusou.
 *
 * Janela deslizante: guarda o instante de cada chamada e só libera a próxima
 * quando a mais antiga sai da janela.
 *
 * Uma instância vale por processo, não por conta. Para limitar por conta, use
 * um `Map<chave, RateLimiter>`.
 */
export class RateLimiter {
  /** Instantes das chamadas ainda dentro da janela. */
  private recentes: number[] = [];
  private fila: Tarefa[] = [];
  private agendado = false;

  constructor(
    private readonly limite = 3,
    private readonly janelaMs = 1000,
  ) {
    if (limite < 1) throw new RangeError('limite precisa ser pelo menos 1');
    if (janelaMs < 1) throw new RangeError('janelaMs precisa ser positivo');
  }

  /** Executa quando houver vaga na janela. */
  schedule<T>(acao: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.fila.push(() => {
        acao().then(resolve, reject);
      });
      this.bombear();
    });
  }

  private bombear(): void {
    const agora = Date.now();
    this.recentes = this.recentes.filter(
      (instante) => agora - instante < this.janelaMs,
    );

    while (this.fila.length > 0 && this.recentes.length < this.limite) {
      this.recentes.push(agora);
      const tarefa = this.fila.shift();
      tarefa?.();
    }

    if (this.fila.length === 0 || this.agendado) return;

    // Acorda quando a chamada mais antiga sair da janela.
    const maisAntiga = this.recentes[0] ?? agora;
    const espera = Math.max(1, this.janelaMs - (agora - maisAntiga));
    this.agendado = true;
    const timer = setTimeout(() => {
      this.agendado = false;
      this.bombear();
    }, espera);
    // Não segura o processo vivo só por causa da fila.
    timer.unref?.();
  }
}
