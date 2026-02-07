
import React, { useState, useEffect, useMemo } from 'react';
import { User, RANKS, AvatarConfig, AvatarVoice, SessionResult, DetailedFeedback, MetricDetail } from '../types';
import {
  cancelUserSubscription,
  getPendingSubscriptionPayment,
  getLatestSubscriptionPayment,
  updateUserStats,
  getStoredDetailedFeedback,
  upsertDetailedFeedback
} from '../services/supabase';
import { cancelSubscription } from '../services/asaas';
import { generateDetailedFeedback } from '../services/gemini';

interface DashboardProps {
  user: User;
  history: SessionResult[];
  onStartSession: (avatar: AvatarConfig) => void;
  onLogout: () => void;
  onAddCredits: () => void;
  onSubscribe: () => void;
  onUpdateProfile: (data: { name: string, surname: string, phone?: string }) => Promise<boolean>;
  onPartialUpdate?: (updates: Partial<User>) => void;
}

const AVATARS: AvatarConfig[] = [
  {
    name: 'Léo',
    accent: 'American',
    voice: AvatarVoice.Puck,
    systemInstruction: `PERSONALITY: Friendly American athlete. 
    STYLE: Casual and direct.
    RULE: NEVER repeat the user's sentence. If they speak well, just keep the chat going. Use "Correction:" only if they fail grammar completely.`,
    description: 'Um cara legal que adora esportes. Ele conversa naturalmente e te ajuda a corrigir erros de forma direta e sem enrolação.',
    color: 'bg-orange-500',
    avatarImage: 'https://images.unsplash.com/photo-1599566150163-29194dcaad36?q=80&w=800&auto=format&fit=crop',
    videoUrl: ''
  },
  {
    name: 'Sophia',
    accent: 'American',
    voice: AvatarVoice.Zephyr,
    systemInstruction: `PERSONALITY: Sophisticated professional mentor.
    STYLE: Warm, clear, and high-level.
    RULE: Do not parrot the user. Respond to the ideas, not the grammar, unless there is an error to fix using "Correction:".`,
    description: 'Profissional e acolhedora. Ela foca no diálogo sobre carreira e é rigorosa em manter a conversa fluindo com qualidade.',
    color: 'bg-purple-500',
    avatarImage: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?q=80&w=800&auto=format&fit=crop',
    videoUrl: ''
  },
  {
    name: 'James',
    accent: 'British',
    voice: AvatarVoice.Fenrir,
    systemInstruction: `PERSONALITY: Intelligent British gentleman.
    STYLE: Witty and polite.
    RULE: Strictly ignore correct sentences and move forward. Only use "Correction:" for significant blunders.`,
    description: 'Sotaque britânico polido. Ele engaja em conversas inteligentes e corrige rigorosamente seus erros para você soar impecável.',
    color: 'bg-emerald-600',
    avatarImage: 'https://images.unsplash.com/photo-1560250097-0b93528c311a?q=80&w=800&auto=format&fit=crop',
    videoUrl: ''
  },
  {
    name: 'Maya',
    accent: 'American',
    voice: AvatarVoice.Kore,
    systemInstruction: `PERSONALITY: Energetic, trendy Gen-Z friend.
    STYLE: Fast, lots of slang, very social.
    RULE: NO REPEATING. Just chat like we are on a call. Use "Correction:" if I say something really weird.`,
    description: 'Energia pura! Ela fala como uma jovem nativa, usa gírias e não deixa passar nenhum erro de gramática enquanto fofoca.',
    color: 'bg-rose-500',
    avatarImage: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?q=80&w=800&auto=format&fit=crop',
    videoUrl: ''
  }
];

const SimpleLineChart: React.FC<{ data: { data: string, score: number }[], color: string }> = ({ data, color }) => {
  if (!data || data.length < 2) return <div className="h-16 flex items-center justify-center text-[10px] text-gray-500 italic">Dados insuficientes para gráfico</div>;

  const width = 200;
  const height = 40;
  const padding = 5;
  const minScore = 0;
  const maxScore = 100;

  const points = data.map((d, i) => {
    const x = (i / (data.length - 1)) * (width - 2 * padding) + padding;
    const y = height - ((d.score - minScore) / (maxScore - minScore)) * (height - 2 * padding) - padding;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} className="mt-2">
      <polyline fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" points={points} className="drop-shadow-sm" />
    </svg>
  );
};

const SimpleRadarChart: React.FC<{ metrics: { label: string, score: number }[] }> = ({ metrics }) => {
  const size = 300;
  const center = size / 2;
  const radius = center - 40;
  const angleStep = (Math.PI * 2) / metrics.length;

  const getPoint = (score: number, index: number, maxRadius: number) => {
    const r = (score / 100) * maxRadius;
    const angle = angleStep * index - Math.PI / 2;
    return {
      x: center + r * Math.cos(angle),
      y: center + r * Math.sin(angle)
    };
  };

  const polyPoints = metrics.map((m, i) => {
    const p = getPoint(m.score, i, radius);
    return `${p.x},${p.y}`;
  }).join(' ');

  const gridLevels = [25, 50, 75, 100];

  return (
    <div className="flex justify-center items-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="filter drop-shadow-lg">
        {gridLevels.map(level => (
          <polygon
            key={level}
            points={metrics.map((_, i) => {
              const p = getPoint(level, i, radius);
              return `${p.x},${p.y}`;
            }).join(' ')}
            fill="none"
            stroke="rgba(255,255,255,0.05)"
            strokeWidth="1"
          />
        ))}
        {metrics.map((_, i) => {
          const p = getPoint(100, i, radius);
          return (
            <line key={i} x1={center} y1={center} x2={p.x} y2={p.y} stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
          );
        })}
        <polygon points={polyPoints} fill="rgba(59, 130, 246, 0.3)" stroke="#3b82f6" strokeWidth="3" strokeLinejoin="round" />
        {metrics.map((m, i) => {
          const p = getPoint(m.score, i, radius);
          return <circle key={i} cx={p.x} cy={p.y} r="4" fill="#60a5fa" />;
        })}
        {metrics.map((m, i) => {
          const p = getPoint(115, i, radius);
          return (
            <text
              key={i}
              x={p.x}
              y={p.y}
              fill="rgba(255,255,255,0.6)"
              fontSize="10"
              fontWeight="bold"
              textAnchor="middle"
              className="uppercase tracking-tighter"
            >
              {m.label}
            </text>
          );
        })}
      </svg>
    </div>
  );
};

const Dashboard: React.FC<DashboardProps> = ({ user, history, onStartSession, onLogout, onAddCredits, onSubscribe, onUpdateProfile, onPartialUpdate }) => {
  const [activeTab, setActiveTab] = useState<'practice' | 'history' | 'profile' | 'feedback'>('practice');
  const [expandedHistoryId, setExpandedHistoryId] = useState<number | null>(null);
  const [showRankList, setShowRankList] = useState(false); // Default hidden

  // Filtros de Histórico
  const [filterAvatar, setFilterAvatar] = useState<string>('all');
  const [filterDate, setFilterDate] = useState<string>('');

  // Lógica de Filtragem - Corrigida para considerar fuso horário local
  const filteredHistory = useMemo(() => {
    return history.filter(session => {
      const matchesAvatar = filterAvatar === 'all' || session.avatarName === filterAvatar;

      // Converte a data ISO para o formato YYYY-MM-DD local para comparar com o input date
      const sessionLocalDate = new Date(session.date).toLocaleDateString('en-CA'); // en-CA retorna YYYY-MM-DD
      const matchesDate = !filterDate || sessionLocalDate === filterDate;

      return matchesAvatar && matchesDate;
    });
  }, [history, filterAvatar, filterDate]);

  // Paginação Baseada em Dados Filtrados
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const totalPages = Math.ceil(filteredHistory.length / itemsPerPage);

  const paginatedHistory = useMemo(() => {
    return filteredHistory.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  }, [filteredHistory, currentPage]);

  // Resetar página ao mudar filtros
  useEffect(() => {
    setCurrentPage(1);
    setExpandedHistoryId(null);
  }, [filterAvatar, filterDate]);

  const [profileForm, setProfileForm] = useState({
    name: user.name || '',
    surname: user.surname || '',
    phone: user.phone || ''
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isCanceling, setIsCanceling] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelCpf, setCancelCpf] = useState(user.cpf || '');
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const [pendingInvoiceUrl, setPendingInvoiceUrl] = useState<string | null>(null);
  const [subscriptionErrorStatus, setSubscriptionErrorStatus] = useState<string | null>(null);

  // Feedback detalhado
  const [detailedFeedback, setDetailedFeedback] = useState<DetailedFeedback | null>(null);
  const [lastEvaluatedSessionDate, setLastEvaluatedSessionDate] = useState<string | null>(null);
  const [isLoadingFeedback, setIsLoadingFeedback] = useState(false);

  useEffect(() => {
    const checkSubscriptionStatus = async () => {
      if (user.id && user.subscription && user.subscription !== 'free' && user.subscription !== 'CANCELLED') {
        const latestPayment = await getLatestSubscriptionPayment(user.id);
        if (latestPayment) {
          if (latestPayment.status === 'PENDING' && latestPayment.url_invoice) {
            setPendingInvoiceUrl(latestPayment.url_invoice);
            setSubscriptionErrorStatus(null);
          } else if (latestPayment.status === 'SUSPENDED') {
            setSubscriptionErrorStatus(latestPayment.status);
            setPendingInvoiceUrl(null);
          } else {
            setPendingInvoiceUrl(null);
            setSubscriptionErrorStatus(null);
          }
        }
      } else {
        setPendingInvoiceUrl(null);
        setSubscriptionErrorStatus(null);
      }
    };
    checkSubscriptionStatus();
  }, [user.id, user.subscription]);

  const loadFeedback = async () => {
    if (history.length === 0 || !user.id) return;

    const latestSession = history[0];

    setIsLoadingFeedback(true);
    try {
      const stored = await getStoredDetailedFeedback(user.id);

      if (stored && new Date(stored.lastDate).getTime() >= new Date(latestSession.date).getTime()) {
        setDetailedFeedback(stored.content);
        setLastEvaluatedSessionDate(stored.lastDate);
        setIsLoadingFeedback(false);
        return;
      }

      const feedback = await generateDetailedFeedback(latestSession.transcript, history);
      if (feedback) {
        setDetailedFeedback(feedback);
        setLastEvaluatedSessionDate(latestSession.date);
        await upsertDetailedFeedback(user.id, feedback, latestSession.date);
      }
    } catch (err) {
      console.error("[Dashboard] Error loading feedback:", err);
    } finally {
      setIsLoadingFeedback(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'feedback') {
      loadFeedback();
    }
    // Reset da página ao trocar de aba (limpa filtros se desejar, ou apenas página)
    if (activeTab !== 'history') {
      setCurrentPage(1);
      setExpandedHistoryId(null);
    }
  }, [activeTab]);

  const isSubscribed = !!user.subscription && user.subscription !== 'free' && user.subscription !== 'CANCELLED';
  const isPending = user.subscriptionStatus === 'PENDING';
  const isCancelled = user.subscription === 'CANCELLED' || user.subscriptionStatus === 'CANCELLED';
  const creditsInMinutes = Math.floor(Number(user.creditsRemaining || 0));
  const hasNoCredits = creditsInMinutes <= 0;
  const isFree = !user.subscription || user.subscription === 'free';

  const currentPoints = user.points || 0;
  const currentRankIndex = RANKS.findIndex((r, idx) => {
    const nextRank = RANKS[idx + 1];
    return currentPoints >= r.minPoints && (!nextRank || currentPoints < nextRank.minPoints);
  });
  const currentRank = RANKS[currentRankIndex] || RANKS[0];
  const nextRank = RANKS[currentRankIndex + 1];

  let progressPercentage = 100;
  let pointsToNext = 0;
  let levelRange = 0;

  if (nextRank) {
    levelRange = nextRank.minPoints - currentRank.minPoints;
    const pointsInCurrentLevel = currentPoints - currentRank.minPoints;
    progressPercentage = Math.min(100, Math.max(0, (pointsInCurrentLevel / levelRange) * 100));
    pointsToNext = nextRank.minPoints - currentPoints;
  }

  const handleAvatarClick = (avatar: AvatarConfig) => {
    if (isCancelled) {
      onSubscribe();
      return;
    }
    if (subscriptionErrorStatus) {
      alert(`Acesso bloqueado: O pagamento da sua mensalidade está com problemas. Acesse seu Perfil para regularizar.`);
      setActiveTab('profile');
      return;
    }
    if (isPending) {
      alert("Acesso bloqueado: O seu pagamento ainda não foi processado pela operadora do cartão.");
      return;
    }
    if (hasNoCredits) {
      alert("Você está sem créditos. Adicione créditos para continuar praticando!");
      onAddCredits();
      return;
    }
    onStartSession(avatar);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    const success = await onUpdateProfile(profileForm);
    setSaveMessage(success ? { type: 'success', text: 'Perfil atualizado!' } : { type: 'error', text: 'Erro ao salvar.' });
    setIsSaving(false);
    setTimeout(() => setSaveMessage(null), 3000);
  };

  const executeCancellation = async () => {
    const cleanCpf = cancelCpf.replace(/\D/g, '');
    if (cleanCpf.length !== 11) {
      alert("Por favor, informe um CPF válido para prosseguir.");
      return;
    }
    setIsCanceling(true);
    try {
      const cancelData = {
        nome: `${user.name} ${user.surname}`,
        email: user.email || '',
        cpf: cleanCpf,
        custumer_id_asaas: user.customerIdAsaas || '',
        subscription: user.subscription || ''
      };
      const webhookSuccess = await cancelSubscription(cancelData);
      if (webhookSuccess) {
        const dbSuccess = await cancelUserSubscription(user.id!);
        if (dbSuccess) {
          if (onPartialUpdate) onPartialUpdate({ subscription: 'CANCELLED', cpf: cleanCpf, subscriptionStatus: 'CANCELLED' });
          alert("Assinatura cancelada com sucesso!");
          setShowCancelConfirm(false);
          setSubscriptionErrorStatus(null);
          setPendingInvoiceUrl(null);
          setActiveTab('practice');
        }
      }
    } catch (err: any) {
      alert(`Falha no cancelamento: ${err.message || 'Erro de rede'}`);
    } finally {
      setIsCanceling(false);
    }
  };

  const handleBannerAction = () => {
    if (isPending && pendingInvoiceUrl) {
      window.open(pendingInvoiceUrl, '_blank');
    } else {
      setActiveTab('profile');
    }
  };

  const TrendIcon = ({ tendencia }: { tendencia: string }) => {
    if (tendencia === 'evoluindo') return <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"></path></svg>;
    if (tendencia === 'regredindo') return <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M13 17h8m0 0v-8m0 8l-8-8-4 4-6-6"></path></svg>;
    return <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 12h14"></path></svg>;
  };

  const radarMetrics = detailedFeedback ? [
    { label: 'Fluência', score: detailedFeedback.metricas_atuais.fluencia.score },
    { label: 'Vocabulário', score: detailedFeedback.metricas_atuais.vocabulario.score },
    { label: 'Gramática', score: detailedFeedback.metricas_atuais.precisao_gramatical.score },
    { label: 'Pronúncia', score: detailedFeedback.metricas_atuais.clareza_pronuncia.score },
    { label: 'Coerência', score: detailedFeedback.metricas_atuais.coerencia.score },
    { label: 'Confiança', score: detailedFeedback.metricas_atuais.confianca.score },
  ] : [];

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      {showCancelConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-md p-4 animate-fade-in">
          <div className="bg-gray-800 border border-red-500/30 rounded-3xl p-8 max-w-sm w-full shadow-2xl space-y-6 text-center">
            <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center text-red-500 mx-auto">
              <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
            </div>
            <div>
              <h3 className="text-xl font-bold mb-2">Cancelar Assinatura?</h3>
              <p className="text-xs text-red-400 font-medium mt-2">⚠️ Ao cancelar, seu acesso as sessões serão encerradas imediatamente e créditos não utilizados serão perdidos.</p>
            </div>
            <div className="text-left space-y-2">
              <label className="text-[10px] font-bold text-gray-500 uppercase">Confirme seu CPF</label>
              <input type="text" value={cancelCpf} onChange={(e) => setCancelCpf(e.target.value)} placeholder="000.000.000-00" className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-red-500 outline-none transition-all" />
            </div>
            <div className="flex flex-col gap-3 pt-2">
              <button onClick={executeCancellation} disabled={isCanceling} className="w-full bg-red-600 hover:bg-red-500 text-white font-bold py-4 rounded-xl shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2">{isCanceling ? "Cancelando..." : "Confirmar Cancelamento"}</button>
              <button onClick={() => setShowCancelConfirm(false)} className="w-full bg-gray-700 hover:bg-gray-600 text-gray-300 font-bold py-3 rounded-xl transition-all">Voltar</button>
            </div>
          </div>
        </div>
      )}

      <header className="flex flex-col md:flex-row justify-between items-center mb-8 max-w-6xl mx-auto gap-4">
        <div className="flex flex-col items-center md:items-start">
          <h1 className="text-2xl font-bold text-blue-400">PratiquePRO</h1>
          <p className="text-xs text-gray-400">Olá, <span className="text-white font-bold">{user.name}</span>! Boas-vindas à sua prática.</p>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex items-center bg-gray-800 rounded-lg px-4 py-2 border border-gray-700 gap-4 shadow-lg">
            <div className="text-right">
              <p className="text-[10px] text-gray-400 uppercase font-black tracking-widest">Créditos</p>
              <p className="font-mono font-black text-green-400 text-lg leading-none">{creditsInMinutes} min</p>
            </div>
            <button onClick={onAddCredits} className="bg-green-600 hover:bg-green-500 text-white text-lg px-2.5 py-1 rounded-lg font-bold shadow-green-900/20 shadow-md transition-all active:scale-95">+</button>
          </div>
          <button onClick={onLogout} className="text-sm px-4 py-2 bg-gray-800 rounded-lg border border-gray-700 hover:bg-gray-700 transition-colors">Sair</button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto space-y-8">
        {/* Banner de Erro/Pendência de Pagamento */}
        {(subscriptionErrorStatus || isPending) && (
          <div className={`${isPending ? 'bg-yellow-500/20 border-yellow-500/50' : 'bg-red-500/20 border-red-500/50'} border p-6 rounded-3xl flex flex-col md:flex-row items-center justify-between gap-6 animate-fade-in shadow-xl`}>
            <div className="flex items-center gap-4">
              <div className={`w-12 h-12 ${isPending ? 'bg-yellow-500/20 text-yellow-400' : 'bg-red-500/20 text-red-400'} rounded-full flex items-center justify-center`}>
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
              </div>
              <div>
                <h3 className="font-bold text-white text-lg">{isPending ? 'Pagamento em Processamento' : 'Problemas no pagamento'}</h3>
                <p className="text-sm text-gray-300 max-w-2xl leading-relaxed">
                  {isPending
                    ? 'O seu pagamento ainda não foi processado ou não foi autorizado pela operadora do cartão. Aguarde a confirmação para liberar o acesso ilimitado.'
                    : 'Detectamos um problema no seu pagamento. Cancele e refaça a assinatura para normalizar.'}
                </p>
              </div>
            </div>
            <button onClick={handleBannerAction} className={`${isPending ? 'bg-yellow-600 hover:bg-yellow-500' : 'bg-red-600 hover:bg-red-500'} text-white font-bold px-8 py-3 rounded-2xl shadow-xl whitespace-nowrap`}>
              {isPending && pendingInvoiceUrl ? 'Pagar Fatura' : 'Ir para Perfil'}
            </button>
          </div>
        )}

        {/* Banner de Incentivo à Assinatura (Exibido para usuários Free ou Cancelados) */}
        {(isFree || isCancelled) && !isPending && !subscriptionErrorStatus && (
          <div className="bg-gradient-to-r from-blue-600/20 to-purple-600/20 border border-blue-500/30 p-6 rounded-3xl flex flex-col md:flex-row items-center justify-between gap-6 animate-fade-in shadow-xl">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-blue-500/20 text-blue-400 rounded-full flex items-center justify-center">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-7.714 2.143L11 21l-2.286-6.857L1 12l7.714-2.143L11 3z"></path></svg>
              </div>
              <div>
                <h3 className="font-bold text-white text-lg">{isCancelled ? 'Retome sua evolução!' : 'Pratique sem limites!'}</h3>
                <p className="text-sm text-gray-300 max-w-2xl leading-relaxed">
                  {isCancelled
                    ? 'Sentimos sua falta! Assine novamente o Plano PRO para recuperar seu acesso ilimitado e continuar de onde parou.'
                    : 'Tenha acesso ilimitado! Assine o Plano PRO agora e garanta 30 horas mensais de conversação por um valor especial.'}
                </p>
              </div>
            </div>
            <button onClick={onSubscribe} className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-8 py-3 rounded-2xl shadow-xl whitespace-nowrap transition-all active:scale-95">
              {isCancelled ? 'Reassinar agora' : 'Assinar agora'}
            </button>
          </div>
        )}

        <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-gray-800 p-6 rounded-2xl border border-gray-700">
            <h3 className="text-gray-400 text-xs uppercase mb-1">Pontos Totais</h3>
            <p className="text-4xl font-extrabold text-yellow-400">{currentPoints}</p>
          </div>
          <div
            onClick={() => setShowRankList(!showRankList)}
            className="bg-gray-800 p-6 rounded-2xl border border-gray-700 flex flex-col justify-between cursor-pointer hover:border-blue-500/50 transition-colors group relative"
          >
            <div>
              <div className="flex justify-between items-start">
                <h3 className="text-gray-400 text-xs uppercase mb-1">Sua Patente</h3>
                <svg className={`w-4 h-4 text-gray-500 transition-transform ${showRankList ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
              </div>
              <p className="text-2xl font-bold group-hover:text-blue-400 transition-colors">{currentRank.name}</p>
            </div>

            <div className="mt-4">
              <div className="flex justify-between items-end mb-1">
                <span className="text-[10px] text-gray-500 font-bold uppercase">Progresso</span>
                {nextRank && (
                  <span className="text-[10px] text-gray-400 font-medium">
                    {currentPoints} / {nextRank.minPoints}
                  </span>
                )}
              </div>
              <div className="w-full bg-gray-900 h-2 rounded-full overflow-hidden border border-gray-700/50">
                <div
                  className="h-full bg-gradient-to-r from-blue-600 to-blue-400 transition-all duration-1000 ease-out shadow-[0_0_10px_rgba(59,130,246,0.5)]"
                  style={{ width: `${progressPercentage}%` }}
                ></div>
              </div>
              {nextRank ? (
                <p className="text-[9px] text-gray-500 mt-1.5 text-right font-medium">Faltam {pointsToNext} pontos para <span className="text-blue-400 font-bold">{nextRank.name}</span></p>
              ) : (
                <p className="text-[9px] text-yellow-400 mt-1.5 text-right font-bold uppercase tracking-widest">Nível Máximo Alcançado!</p>
              )}
            </div>
          </div>
          <div className="bg-gray-800 p-6 rounded-2xl border border-gray-700">
            <h3 className="text-gray-400 text-xs uppercase mb-1">Aulas Concluídas</h3>
            <p className="text-4xl font-extrabold">{user.sessionsCompleted}</p>
          </div>
        </section>

        {/* Rank Progression Section */}
        {/* Rank Progression Section - Compact */}
        {showRankList && (
          <section className="bg-gray-800 p-3 rounded-xl border border-gray-700 animate-fade-in">
            <h3 className="text-gray-400 text-[10px] font-bold uppercase mb-2 tracking-widest">Jornada de Evolução</h3>
            <div className="relative">
              <div className="grid grid-cols-2 md:grid-cols-7 gap-2">
                {RANKS.map((rank, idx) => {
                  const isAchieved = currentPoints >= rank.minPoints;
                  const isCurrent = currentRank.name === rank.name;
                  const isNext = nextRank?.name === rank.name;

                  return (
                    <div key={rank.name} className={`relative flex flex-col items-center md:items-start p-2 rounded-lg border transition-all ${isCurrent ? 'bg-blue-600/10 border-blue-500/50 z-10' : isAchieved ? 'bg-gray-800/50 border-transparent opacity-60' : 'bg-transparent border-transparent opacity-40'}`}>
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center mb-1.5 z-10 border ${isCurrent ? 'bg-blue-600 border-blue-400 text-white' : isAchieved ? 'bg-green-600/20 border-green-500/50 text-green-400' : 'bg-gray-800 border-gray-700 text-gray-600'}`}>
                        {isAchieved && !isCurrent ? (
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>
                        ) : (
                          <span className="text-[10px] font-bold">{idx + 1}</span>
                        )}
                      </div>

                      <h4 className={`font-bold text-xs ${isCurrent ? 'text-blue-400' : isAchieved ? 'text-gray-300' : 'text-gray-500'}`}>{rank.name}</h4>
                      <p className="text-[9px] text-gray-500 font-medium">{rank.minPoints} pts</p>

                      {isCurrent && <div className="mt-1 text-[8px] px-1.5 py-px bg-blue-500/20 text-blue-300 border border-blue-500/30 rounded-full font-bold uppercase tracking-wide">Atual</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        <div className="flex flex-wrap gap-4 border-b border-gray-700 pb-2">
          <button onClick={() => setActiveTab('practice')} className={`pb-2 text-lg font-medium transition-all ${activeTab === 'practice' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-400 hover:text-gray-200'}`}>Praticar</button>
          <button onClick={() => setActiveTab('history')} className={`pb-2 text-lg font-medium transition-all ${activeTab === 'history' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-400 hover:text-gray-200'}`}>Histórico</button>
          <button onClick={() => setActiveTab('feedback')} className={`pb-2 text-lg font-medium transition-all ${activeTab === 'feedback' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-400 hover:text-gray-200'}`}>Feedback</button>
          <button onClick={() => setActiveTab('profile')} className={`pb-2 text-lg font-medium transition-all ${activeTab === 'profile' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-400 hover:text-gray-200'}`}>Perfil</button>
        </div>

        {activeTab === 'practice' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 animate-fade-in">
            {AVATARS.map((avatar) => {
              const isDisabled = subscriptionErrorStatus || isCancelled || isPending || hasNoCredits;
              return (
                <div
                  key={avatar.name}
                  className={`bg-gray-800 rounded-3xl overflow-hidden border border-gray-700 transition-all group cursor-pointer ${isDisabled ? 'opacity-50 grayscale' : 'hover:border-blue-500/50'}`}
                  onClick={() => handleAvatarClick(avatar)}
                >
                  <div className="h-64 overflow-hidden relative">
                    <img src={avatar.avatarImage} className={`w-full h-full object-cover transition-transform duration-500 ${isDisabled ? '' : 'group-hover:scale-110'}`} />
                    <div className="absolute inset-0 bg-gradient-to-t from-gray-900 to-transparent opacity-60"></div>
                  </div>
                  <div className="p-6">
                    <h3 className="text-xl font-bold mb-2">{avatar.name}</h3>
                    <p className="text-xs text-gray-400 line-clamp-2 h-8">{avatar.description}</p>
                    <button className={`mt-4 w-full text-white py-3 rounded-xl text-sm font-bold shadow-lg transition-all ${isDisabled ? 'bg-gray-600' : 'bg-blue-600 hover:bg-blue-500'}`}>
                      {isCancelled ? 'Assinar' : isPending ? 'Processando' : hasNoCredits ? 'Sem Créditos' : 'Praticar'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {activeTab === 'history' && (
          <div className="space-y-6 animate-fade-in">
            {/* Toolbar de Filtros */}
            <div className="flex flex-col md:flex-row gap-4 bg-gray-800/50 p-4 rounded-2xl border border-gray-700 mb-2">
              <div className="flex-1 space-y-1">
                <label className="text-[10px] font-black uppercase text-gray-500 tracking-widest px-1">Avatar</label>
                <select
                  value={filterAvatar}
                  onChange={(e) => setFilterAvatar(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                >
                  <option value="all">Todos os Avatares</option>
                  {AVATARS.map(a => <option key={a.name} value={a.name}>{a.name}</option>)}
                </select>
              </div>
              <div className="flex-1 space-y-1">
                <label className="text-[10px] font-black uppercase text-gray-500 tracking-widest px-1">Data</label>
                <input
                  type="date"
                  value={filterDate}
                  onChange={(e) => setFilterDate(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                />
              </div>
              {(filterAvatar !== 'all' || filterDate !== '') && (
                <div className="flex items-end">
                  <button
                    onClick={() => { setFilterAvatar('all'); setFilterDate(''); }}
                    className="px-4 py-2.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs font-bold rounded-xl transition-all h-[42px] whitespace-nowrap"
                  >
                    Limpar Filtros
                  </button>
                </div>
              )}
            </div>

            {filteredHistory.length === 0 ? (
              <div className="bg-gray-800 p-12 rounded-3xl border border-gray-700 text-center">
                <p className="text-gray-500">
                  {history.length === 0
                    ? "Você ainda não realizou nenhuma sessão."
                    : "Nenhum resultado encontrado para os filtros selecionados."}
                </p>
              </div>
            ) : (
              <>
                <div className="space-y-4">
                  {paginatedHistory.map((session, idx) => {
                    // Ajuste do índice para expansão correta em dados filtrados
                    const actualIdx = (currentPage - 1) * itemsPerPage + idx;
                    return (
                      <div key={`${session.date}-${idx}`} className="bg-gray-800 rounded-2xl border border-gray-700 overflow-hidden transition-all">
                        <div className="p-6 flex flex-col md:flex-row items-center justify-between gap-4">
                          <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-blue-500/10 rounded-full flex items-center justify-center text-blue-400 font-bold">
                              {session.overallScore}
                            </div>
                            <div>
                              <h4 className="font-bold">Conversa com {session.avatarName}</h4>
                              <p className="text-xs text-gray-500">{new Date(session.date).toLocaleDateString('pt-BR')}</p>
                            </div>
                          </div>
                          <button onClick={() => setExpandedHistoryId(expandedHistoryId === actualIdx ? null : actualIdx)} className={`p-2 hover:bg-gray-700 rounded-lg transition-colors ${expandedHistoryId === actualIdx ? 'rotate-180' : ''}`}>
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                          </button>
                        </div>
                        {expandedHistoryId === actualIdx && (
                          <div className="px-6 pb-6 pt-2 border-t border-gray-700 bg-gray-900/30 animate-fade-in space-y-6">
                            <div className="bg-gray-800/50 p-4 rounded-xl border border-gray-700">
                              <h5 className="text-[10px] uppercase text-gray-500 font-bold mb-2 tracking-widest">Feedback da Sessão</h5>
                              <p className="text-sm text-gray-300 italic">"{session.feedback}"</p>
                            </div>

                            <div className="grid grid-cols-3 gap-2">
                              <div className="text-center bg-gray-800 p-2 rounded-lg"><p className="text-[9px] uppercase text-gray-500">Vocab</p><p className="font-bold text-xs">{session.vocabularyScore}</p></div>
                              <div className="text-center bg-gray-800 p-2 rounded-lg"><p className="text-[9px] uppercase text-gray-500">Gram</p><p className="font-bold text-xs">{session.grammarScore}</p></div>
                              <div className="text-center bg-gray-800 p-2 rounded-lg"><p className="text-[9px] uppercase text-gray-500">Pron</p><p className="font-bold text-xs">{session.pronunciationScore}</p></div>
                            </div>

                            <div className="border-t border-gray-700 pt-4">
                              <h5 className="text-[10px] uppercase text-gray-500 font-bold mb-3 tracking-widest">Transcrição Completa</h5>
                              <div className="bg-gray-900/80 rounded-xl p-4 max-h-[500px] overflow-y-auto custom-scrollbar space-y-4 shadow-inner">
                                {session.transcript ? (
                                  session.transcript.split('\n').filter(line => line.trim()).map((line, lIdx) => {
                                    const isUser = line.toLowerCase().startsWith('user:');
                                    const isAvatar = line.toLowerCase().startsWith('avatar:');
                                    const text = line.replace(/^(User|Avatar): /i, '');

                                    if (!isUser && !isAvatar) return <p key={lIdx} className="text-[11px] text-gray-500 text-center py-1">{line}</p>;

                                    return (
                                      <div key={lIdx} className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
                                        <span className="text-[8px] text-gray-600 mb-0.5 uppercase font-black tracking-tighter">
                                          {isUser ? 'Você' : session.avatarName}
                                        </span>
                                        <div className={`text-xs px-4 py-2.5 rounded-2xl max-w-[90%] leading-relaxed ${isUser ? 'bg-blue-600/20 text-blue-100 border border-blue-500/20 rounded-tr-none' : 'bg-gray-800 text-gray-300 border border-gray-700 rounded-tl-none'}`}>
                                          {text}
                                        </div>
                                      </div>
                                    );
                                  })
                                ) : (
                                  <p className="text-gray-600 text-[10px] text-center italic">Transcrição indisponível para esta sessão.</p>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Paginação */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-center gap-4 py-4">
                    <button
                      onClick={() => { setCurrentPage(prev => Math.max(1, prev - 1)); setExpandedHistoryId(null); }}
                      disabled={currentPage === 1}
                      className="p-2 bg-gray-800 rounded-xl border border-gray-700 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7"></path></svg>
                    </button>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-black uppercase text-gray-500 tracking-widest">Página</span>
                      <span className="bg-blue-600 px-3 py-1 rounded-lg text-xs font-bold">{currentPage}</span>
                      <span className="text-xs font-black uppercase text-gray-500 tracking-widest">de {totalPages}</span>
                    </div>
                    <button
                      onClick={() => { setCurrentPage(prev => Math.min(totalPages, prev + 1)); setExpandedHistoryId(null); }}
                      disabled={currentPage === totalPages}
                      className="p-2 bg-gray-800 rounded-xl border border-gray-700 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path></svg>
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {activeTab === 'feedback' && (
          <div className="space-y-8 animate-fade-in">
            {history.length === 0 ? (
              <div className="bg-gray-800 p-12 rounded-3xl border border-gray-700 text-center">
                <p className="text-gray-500">Realize sua primeira sessão para receber feedback detalhado.</p>
              </div>
            ) : isLoadingFeedback ? (
              <div className="bg-gray-800 p-20 rounded-3xl border border-gray-700 flex flex-col items-center justify-center space-y-4">
                <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                <p className="text-gray-400 font-medium">O Agente de Avaliação está analisando seu progresso...</p>
              </div>
            ) : detailedFeedback ? (
              <div className="space-y-6">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="bg-gradient-to-br from-blue-900/30 to-purple-900/30 border border-blue-500/30 p-8 rounded-3xl shadow-xl flex flex-col justify-center">
                    <h3 className="text-xl font-black mb-4 flex items-center gap-2">
                      <svg className="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                      Resumo do seu Aprendizado
                    </h3>
                    <p className="text-lg text-gray-200 leading-relaxed italic">"{detailedFeedback.resumo_geral}"</p>
                  </div>

                  <div className="bg-gray-800 p-6 rounded-3xl border border-gray-700 shadow-xl flex flex-col items-center">
                    <h3 className="text-xs font-black uppercase text-gray-500 mb-2 tracking-widest">Gráfico de Radar de Competências</h3>
                    <SimpleRadarChart metrics={radarMetrics} />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {Object.entries(detailedFeedback.metricas_atuais).map(([key, val]) => {
                    const metric = val as MetricDetail;
                    const label = key.replace('_', ' ');
                    const color = metric.score > 70 ? 'text-green-400' : metric.score > 40 ? 'text-yellow-400' : 'text-red-400';
                    const chartColor = metric.score > 70 ? '#4ade80' : metric.score > 40 ? '#facc15' : '#f87171';

                    return (
                      <div key={key} className="bg-gray-800 p-6 rounded-2xl border border-gray-700 flex flex-col justify-between transition-all hover:border-gray-600">
                        <div>
                          <div className="flex justify-between items-start mb-4">
                            <h4 className="text-xs font-black uppercase text-gray-400 tracking-wider">{label}</h4>
                            <div className="flex items-center gap-1">
                              <span className={`text-[10px] font-bold uppercase ${metric.tendencia === 'evoluindo' ? 'text-green-400' : metric.tendencia === 'regredindo' ? 'text-red-400' : 'text-gray-400'}`}>{metric.tendencia}</span>
                              <TrendIcon tendencia={metric.tendencia} />
                            </div>
                          </div>
                          <div className="flex items-end gap-2 mb-4">
                            <span className={`text-4xl font-black ${color}`}>{metric.score}</span>
                            <span className="text-gray-600 text-xs mb-1">/ 100</span>
                          </div>
                          <p className="text-xs text-gray-400 leading-relaxed mb-4">{(detailedFeedback.feedbacks as any)[key]}</p>
                        </div>
                        <div className="border-t border-gray-700 pt-4 mt-auto">
                          <p className="text-[9px] text-gray-500 uppercase font-black mb-1">Evolução Histórica</p>
                          <SimpleLineChart
                            data={(detailedFeedback.dados_grafico_historico as any)[key]}
                            color={chartColor}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="bg-red-500/10 p-8 rounded-3xl border border-red-500/30 text-center">
                <p className="text-red-400">Não foi possível carregar o feedback detalhado agora. Tente novamente em alguns instantes.</p>
                <button onClick={loadFeedback} className="mt-4 bg-gray-700 hover:bg-gray-600 px-6 py-2 rounded-xl text-sm font-bold">Tentar novamente</button>
              </div>
            )}
          </div>
        )}

        {activeTab === 'profile' && (
          <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
            <form onSubmit={handleSaveProfile} className="bg-gray-800 p-8 rounded-3xl border border-gray-700 space-y-6">
              <h3 className="text-xl font-bold">Dados Pessoais</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase">Nome</label>
                  <input type="text" value={profileForm.name} onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })} className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-xl text-white outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase">Sobrenome</label>
                  <input type="text" value={profileForm.surname} onChange={(e) => setProfileForm({ ...profileForm, surname: e.target.value })} className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-xl text-white outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-400 uppercase">Telefone</label>
                <input type="text" value={profileForm.phone} onChange={(e) => setProfileForm({ ...profileForm, phone: e.target.value })} placeholder="(00) 00000-0000" className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-xl text-white outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              {saveMessage && <p className={`text-sm p-3 rounded-xl border ${saveMessage.type === 'success' ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-red-500/10 border-red-500/30 text-red-400'}`}>{saveMessage.text}</p>}
              <button type="submit" disabled={isSaving} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-4 rounded-xl shadow-lg transition-all disabled:opacity-50">{isSaving ? "Salvando..." : "Salvar Alterações"}</button>
            </form>
            <div className="bg-gray-800 p-8 rounded-3xl border border-gray-700 space-y-6">
              <div className="flex justify-between items-center">
                <h3 className="text-xl font-bold">Assinatura</h3>
                <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest ${user.subscription && user.subscription !== 'free' ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-gray-700 text-gray-400'}`}>{user.subscription && user.subscription !== 'free' ? (isCancelled ? 'CANCELADA' : (subscriptionErrorStatus ? `Problema` : (isPending ? 'PROCESSANDO' : 'Ativa'))) : 'Free'}</span>
              </div>
              {user.subscription && user.subscription !== 'free' && !isCancelled ? (
                <button onClick={() => setShowCancelConfirm(true)} className="w-full bg-red-500/10 hover:bg-red-500/20 text-red-400 font-bold py-3 rounded-xl border border-red-500/20 transition-all">Cancelar Assinatura Atual</button>
              ) : (
                <button onClick={onSubscribe} className="w-full bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 font-bold py-3 rounded-xl border border-blue-500/20 transition-all">Assinar Agora</button>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default Dashboard;