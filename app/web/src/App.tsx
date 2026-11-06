import React, { useState, useEffect } from 'react';
import { Compass, Dices, Home, Maximize2, MessageSquare, Send, Shield, Users } from 'lucide-react';

interface ChatMessage {
  id: string;
  user: string;
  text: string;
  time: string;
}

interface DiceRoll {
  id: string;
  user: string;
  expression: string;
  result: number;
  total: number;
  time: string;
}

interface AuthUser {
  id: string;
  username: string;
  email?: string;
}

interface Room {
  id: string;
  name: string;
  description: string;
  gameSystem: string;
  role: 'gm' | 'player' | 'spectator' | null;
  accessType: 'public' | 'password' | 'private';
  requiresPassword: boolean;
  memberCount: number;
}

interface RoomMember {
  id: string;
  username: string;
  role: 'gm' | 'player' | 'spectator';
  mutedUntil: string | null;
}

interface Campaign {
  id: string;
  name: string;
  description: string;
}

interface CampaignNote {
  id: string;
  title: string;
  content: string;
}

interface Character {
  id: string;
  ownerUserId: string;
  campaignId: string | null;
  name: string;
  data: Record<string, unknown>;
}

interface LibraryItem {
  id: string;
  roomId: string;
  parentId: string | null;
  itemType: 'folder' | 'map';
  name: string;
  visibility: 'private' | 'room';
  data: { width?: number; height?: number; backgroundUrl?: string | null };
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const API_BASE = import.meta.env.VITE_API_URL || (import.meta.env.DEV
  ? `${window.location.protocol}//${window.location.hostname}:4000`
  : window.location.origin);

const DEFAULT_DND5E_CHARACTER = JSON.stringify({
  system: 'dnd5e',
  level: 1,
  proficiencyBonus: 2,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  proficientSaves: [],
  proficientSkills: [],
  hitPoints: { current: 10, maximum: 10 },
  notes: ''
}, null, 2);
const DND5E_SKILLS = [
  'acrobatics', 'animalHandling', 'arcana', 'athletics', 'deception', 'history',
  'insight', 'intimidation', 'investigation', 'medicine', 'nature', 'perception',
  'performance', 'persuasion', 'religion', 'sleightOfHand', 'stealth', 'survival'
];

function getDnd5eAbilities(data: Record<string, unknown>): Array<[string, number]> {
  if (data.system !== 'dnd5e' || typeof data.abilities !== 'object' || data.abilities === null) return [];
  return Object.entries(data.abilities).filter((entry): entry is [string, number] => typeof entry[1] === 'number');
}

export function App() {
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [activePage, setActivePage] = useState<'lobby' | 'room' | 'campaigns' | 'characters'>('lobby');
  const [mobilePanel, setMobilePanel] = useState<'map' | 'library' | 'chat' | 'dice' | 'members'>('chat');
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [roomSearch, setRoomSearch] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [roomMembers, setRoomMembers] = useState<RoomMember[]>([]);
  const [bannedMembers, setBannedMembers] = useState<Array<{ id: string; username: string; reason: string }>>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const [campaignNotes, setCampaignNotes] = useState<CampaignNote[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [libraryItems, setLibraryItems] = useState<LibraryItem[]>([]);
  const [selectedLibraryItemId, setSelectedLibraryItemId] = useState<string | null>(null);
  const [libraryName, setLibraryName] = useState('');
  const [libraryItemType, setLibraryItemType] = useState<'folder' | 'map'>('folder');
  const [libraryVisibility, setLibraryVisibility] = useState<'private' | 'room'>('room');
  const [libraryWidth, setLibraryWidth] = useState(12);
  const [libraryHeight, setLibraryHeight] = useState(12);
  const [libraryBackgroundUrl, setLibraryBackgroundUrl] = useState('');
  const [libraryParentId, setLibraryParentId] = useState('');
  const [campaignName, setCampaignName] = useState('');
  const [campaignDescription, setCampaignDescription] = useState('');
  const [editingCampaignId, setEditingCampaignId] = useState<string | null>(null);
  const [noteTitle, setNoteTitle] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [characterName, setCharacterName] = useState('');
  const [characterDataText, setCharacterDataText] = useState(DEFAULT_DND5E_CHARACTER);
  const [characterCampaignId, setCharacterCampaignId] = useState('');
  const [characterOwnerId, setCharacterOwnerId] = useState('');
  const [editingCharacterId, setEditingCharacterId] = useState<string | null>(null);
  const [authLoaded, setAuthLoaded] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authUsername, setAuthUsername] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [rooms, setRooms] = useState<Room[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomSystem, setNewRoomSystem] = useState('Sistema próprio');
  const [newRoomAccessType, setNewRoomAccessType] = useState<'public' | 'password'>('public');
  const [newRoomPassword, setNewRoomPassword] = useState('');
  const [joiningRoom, setJoiningRoom] = useState<Room | null>(null);
  const [joinPassword, setJoinPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [diceRolls, setDiceRolls] = useState<DiceRoll[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [diceExpr, setDiceExpr] = useState('1d20');
  const [activeTab, setActiveTab] = useState<'chat' | 'dice' | 'members'>('chat');
  const activeRoom = rooms.find(room => room.id === activeRoomId) || null;
  const isRoomMember = Boolean(activeRoom?.role);
  const selectedLibraryItem = libraryItems.find(item => item.id === selectedLibraryItemId && item.itemType === 'map') || null;
  const gridWidth = selectedLibraryItem?.data.width || 12;
  const gridHeight = selectedLibraryItem?.data.height || 12;

  useEffect(() => {
    const updateOnlineState = () => setIsOnline(navigator.onLine);
    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => {
      setInstallPrompt(null);
      setSuccessMessage('FREECAST foi instalado neste dispositivo.');
    };
    window.addEventListener('online', updateOnlineState);
    window.addEventListener('offline', updateOnlineState);
    window.addEventListener('beforeinstallprompt', handleInstallPrompt);
    window.addEventListener('appinstalled', handleInstalled);
    return () => {
      window.removeEventListener('online', updateOnlineState);
      window.removeEventListener('offline', updateOnlineState);
      window.removeEventListener('beforeinstallprompt', handleInstallPrompt);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  useEffect(() => {
    if (!import.meta.env.PROD) return;
    if (!('serviceWorker' in navigator)) {
      setErrorMessage('Este navegador não oferece suporte a instalação/offline do aplicativo.');
      return;
    }
    navigator.serviceWorker.register('/service-worker.js')
      .catch(error => setErrorMessage(error instanceof Error
        ? `Não foi possível habilitar o shell offline: ${error.message}`
        : 'Não foi possível habilitar o shell offline.'));
  }, []);

  useEffect(() => {
    let active = true;
    fetch(`${API_BASE}/api/me`, { credentials: 'include' })
      .then(async response => {
        const result = await response.json() as { user?: AuthUser | null; error?: string };
        if (!response.ok) throw new Error(result.error || 'Não foi possível verificar a sessão.');
        return result.user || null;
      })
      .then(async currentUser => {
        if (!active) return;
        setUser(currentUser);
        if (currentUser) await refreshRooms();
      })
      .catch(error => {
        if (active) setErrorMessage(error instanceof Error ? error.message : 'Servidor indisponível.');
      })
      .finally(() => {
        if (active) setAuthLoaded(true);
      });
    return () => { active = false; };
  }, []);

  async function refreshRooms() {
    const response = await fetch(`${API_BASE}/api/rooms`, { credentials: 'include' });
    const result = await response.json() as { rooms?: Room[]; error?: string };
    if (!response.ok) throw new Error(result.error || 'Não foi possível carregar as salas.');
    setRooms(result.rooms || []);
  }

  async function refreshLibrary() {
    if (!activeRoomId) return;
    const response = await fetch(`${API_BASE}/api/rooms/${encodeURIComponent(activeRoomId)}/library`, { credentials: 'include' });
    const result = await response.json() as { items?: LibraryItem[]; error?: string };
    if (!response.ok) throw new Error(result.error || 'Não foi possível carregar a biblioteca.');
    setLibraryItems(result.items || []);
    setSelectedLibraryItemId(current => (result.items || []).some(item => item.id === current && item.itemType === 'map') ? current : null);
  }

  const handleSaveLibraryItem = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!activeRoomId) return;
    setErrorMessage('');
    const data = libraryItemType === 'map'
      ? { width: libraryWidth, height: libraryHeight, backgroundUrl: libraryBackgroundUrl || null, tokens: [] }
      : {};
    try {
      const response = await fetch(`${API_BASE}/api/rooms/${encodeURIComponent(activeRoomId)}/library`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          itemType: libraryItemType,
          name: libraryName,
          parentId: libraryParentId || null,
          visibility: libraryVisibility,
          data
        })
      });
      const result = await response.json() as { item?: LibraryItem; error?: string };
      if (!response.ok || !result.item) throw new Error(result.error || 'Não foi possível criar o item.');
      await refreshLibrary();
      setSelectedLibraryItemId(result.item.itemType === 'map' ? result.item.id : null);
      setLibraryName('');
      setLibraryBackgroundUrl('');
      setLibraryParentId('');
      setMobilePanel('chat');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível salvar o item da biblioteca.');
    }
  };

  const handleDeleteLibraryItem = async (item: LibraryItem) => {
    if (!window.confirm(`Excluir ${item.name}${item.itemType === 'folder' ? ' e os itens dentro dela' : ''}?`)) return;
    try {
      const response = await fetch(`${API_BASE}/api/library/${encodeURIComponent(item.id)}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      if (!response.ok) {
        const result = await response.json() as { error?: string };
        throw new Error(result.error || 'Não foi possível excluir o item.');
      }
      await refreshLibrary();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível excluir o item.');
    }
  };

  const handleAuthSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage('');
    setSuccessMessage('');
    try {
      const response = await fetch(`${API_BASE}/api/auth/${authMode === 'register' ? 'register' : 'login'}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(authMode === 'register'
          ? { username: authUsername, email: authEmail, password: authPassword }
          : { identifier: authUsername, password: authPassword })
      });
      const result = await response.json() as { user?: AuthUser; error?: string };
      if (!response.ok || !result.user) throw new Error(result.error || 'Não foi possível autenticar.');
      setUser(result.user);
      setAuthPassword('');
      await refreshRooms();
      setSuccessMessage(`Sessão iniciada como ${result.user.username}.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível autenticar.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const refreshCampaignsAndCharacters = async () => {
    if (!activeRoomId) return;
    const [campaignResponse, characterResponse] = await Promise.all([
      fetch(`${API_BASE}/api/rooms/${encodeURIComponent(activeRoomId)}/campaigns`, { credentials: 'include' }),
      fetch(`${API_BASE}/api/rooms/${encodeURIComponent(activeRoomId)}/characters`, { credentials: 'include' })
    ]);
    const campaignResult = await campaignResponse.json() as { campaigns?: Campaign[]; error?: string };
    const characterResult = await characterResponse.json() as { characters?: Character[]; error?: string };
    if (!campaignResponse.ok) throw new Error(campaignResult.error || 'Não foi possível atualizar as campanhas.');
    if (!characterResponse.ok) throw new Error(characterResult.error || 'Não foi possível atualizar as fichas.');
    setCampaigns(campaignResult.campaigns || []);
    setCharacters(characterResult.characters || []);
  };

  const handleSaveCampaign = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!activeRoomId) return;
    setErrorMessage('');
    try {
      const response = await fetch(editingCampaignId
        ? `${API_BASE}/api/campaigns/${encodeURIComponent(editingCampaignId)}`
        : `${API_BASE}/api/rooms/${encodeURIComponent(activeRoomId)}/campaigns`, {
        method: editingCampaignId ? 'PATCH' : 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: campaignName, description: campaignDescription })
      });
      const result = await response.json() as { campaign?: Campaign; error?: string };
      if (!response.ok || !result.campaign) throw new Error(result.error || 'Não foi possível salvar a campanha.');
      await refreshCampaignsAndCharacters();
      setSelectedCampaignId(result.campaign.id);
      setCampaignName('');
      setCampaignDescription('');
      setEditingCampaignId(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível salvar a campanha.');
    }
  };

  const handleDeleteCampaign = async (campaignId: string) => {
    if (!window.confirm('Excluir esta campanha e suas notas?')) return;
    try {
      const response = await fetch(`${API_BASE}/api/campaigns/${encodeURIComponent(campaignId)}`, { method: 'DELETE', credentials: 'include' });
      if (!response.ok) {
        const result = await response.json() as { error?: string };
        throw new Error(result.error || 'Não foi possível excluir a campanha.');
      }
      await refreshCampaignsAndCharacters();
      setSelectedCampaignId(current => current === campaignId ? '' : current);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível excluir a campanha.');
    }
  };

  const handleSaveNote = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedCampaignId) return;
    try {
      const response = await fetch(editingNoteId
        ? `${API_BASE}/api/campaign-notes/${encodeURIComponent(editingNoteId)}`
        : `${API_BASE}/api/campaigns/${encodeURIComponent(selectedCampaignId)}/notes`, {
        method: editingNoteId ? 'PATCH' : 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: noteTitle, content: noteContent })
      });
      const result = await response.json() as { note?: CampaignNote; error?: string };
      if (!response.ok || !result.note) throw new Error(result.error || 'Não foi possível salvar a nota.');
      const notesResponse = await fetch(`${API_BASE}/api/campaigns/${encodeURIComponent(selectedCampaignId)}/notes`, { credentials: 'include' });
      const notesResult = await notesResponse.json() as { notes?: CampaignNote[]; error?: string };
      if (!notesResponse.ok) throw new Error(notesResult.error || 'A nota foi salva, mas a lista não pôde ser atualizada.');
      setCampaignNotes(notesResult.notes || []);
      setNoteTitle('');
      setNoteContent('');
      setEditingNoteId(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível salvar a nota.');
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    try {
      const response = await fetch(`${API_BASE}/api/campaign-notes/${encodeURIComponent(noteId)}`, { method: 'DELETE', credentials: 'include' });
      if (!response.ok) {
        const result = await response.json() as { error?: string };
        throw new Error(result.error || 'Não foi possível excluir a nota.');
      }
      setCampaignNotes(notes => notes.filter(note => note.id !== noteId));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível excluir a nota.');
    }
  };

  const handleSaveCharacter = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!activeRoomId) return;
    setErrorMessage('');
    try {
      const parsedData: unknown = JSON.parse(characterDataText);
      if (!parsedData || typeof parsedData !== 'object' || Array.isArray(parsedData)) throw new Error('Os dados da ficha devem ser um objeto JSON.');
      const response = await fetch(editingCharacterId
        ? `${API_BASE}/api/characters/${encodeURIComponent(editingCharacterId)}`
        : `${API_BASE}/api/rooms/${encodeURIComponent(activeRoomId)}/characters`, {
        method: editingCharacterId ? 'PATCH' : 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: characterName,
          campaignId: characterCampaignId || null,
          data: parsedData,
          ...(!editingCharacterId && activeRoom?.role === 'gm' ? { ownerUserId: characterOwnerId || user?.id } : {})
        })
      });
      const result = await response.json() as { character?: Character; error?: string };
      if (!response.ok || !result.character) throw new Error(result.error || 'Não foi possível salvar a ficha.');
      await refreshCampaignsAndCharacters();
      setCharacterName('');
      setCharacterDataText(DEFAULT_DND5E_CHARACTER);
      setCharacterCampaignId('');
      setCharacterOwnerId('');
      setEditingCharacterId(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Dados JSON inválidos.');
    }
  };

  const handleCharacterCheck = (characterId: string, kind: 'ability' | 'savingThrow' | 'skill', key: string) => {
    if (activeRoom?.role === 'spectator') {
      setErrorMessage('Espectadores podem conversar, mas não rolar testes.');
      return;
    }
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setErrorMessage('Sala desconectada. O teste não foi enviado ao servidor.');
      return;
    }
    ws.send(JSON.stringify({ type: 'ROLL_CHARACTER_CHECK', payload: { characterId, kind, key } }));
  };

  const handleDeleteCharacter = async (characterId: string) => {
    if (!window.confirm('Excluir esta ficha?')) return;
    try {
      const response = await fetch(`${API_BASE}/api/characters/${encodeURIComponent(characterId)}`, { method: 'DELETE', credentials: 'include' });
      if (!response.ok) {
        const result = await response.json() as { error?: string };
        throw new Error(result.error || 'Não foi possível excluir a ficha.');
      }
      setCharacters(items => items.filter(character => character.id !== characterId));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível excluir a ficha.');
    }
  };

  const handleModeration = async (target: RoomMember | { id: string; username: string }, action: 'mute' | 'unmute' | 'kick' | 'ban' | 'unban') => {
    if (!activeRoomId) return;
    const confirmed = action === 'kick' || action === 'ban'
      ? window.confirm(`${action === 'ban' ? 'Banir' : 'Remover'} ${target.username} desta sala?`)
      : true;
    if (!confirmed) return;
    setErrorMessage('');
    try {
      const response = await fetch(`${API_BASE}/api/rooms/${encodeURIComponent(activeRoomId)}/members/${encodeURIComponent(target.id)}/moderation`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, durationMinutes: 10 })
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || 'Não foi possível aplicar a moderação.');
      const roomResponse = await fetch(`${API_BASE}/api/rooms/${encodeURIComponent(activeRoomId)}`, { credentials: 'include' });
      const roomResult = await roomResponse.json() as { members?: RoomMember[]; bannedMembers?: Array<{ id: string; username: string; reason: string }>; error?: string };
      if (!roomResponse.ok) throw new Error(roomResult.error || 'A moderação foi aplicada, mas não foi possível atualizar a lista.');
      setRoomMembers(roomResult.members || []);
      setBannedMembers(roomResult.bannedMembers || []);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível aplicar a moderação.');
    }
  };

  const handleSetMemberRole = async (member: RoomMember, role: 'player' | 'spectator') => {
    if (!activeRoomId) return;
    try {
      const response = await fetch(`${API_BASE}/api/rooms/${encodeURIComponent(activeRoomId)}/members/${encodeURIComponent(member.id)}/role`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role })
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || 'Não foi possível alterar o papel.');
      const roomResponse = await fetch(`${API_BASE}/api/rooms/${encodeURIComponent(activeRoomId)}`, { credentials: 'include' });
      const roomResult = await roomResponse.json() as { members?: RoomMember[]; error?: string };
      if (!roomResponse.ok) throw new Error(roomResult.error || 'Papel alterado, mas não foi possível atualizar a lista.');
      setRoomMembers(roomResult.members || []);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível alterar o papel.');
    }
  };

  const handleJoinRoom = async (room: Room) => {
    setIsSubmitting(true);
    setErrorMessage('');
    try {
      const response = await fetch(`${API_BASE}/api/rooms/${encodeURIComponent(room.id)}/join`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: joinPassword })
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || 'Não foi possível entrar na sala.');
      await refreshRooms();
      setActiveRoomId(room.id);
      setActivePage('room');
      setMobilePanel('map');
      setJoiningRoom(null);
      setJoinPassword('');
      setSuccessMessage('');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível entrar na sala.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateRoom = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage('');
    try {
      const response = await fetch(`${API_BASE}/api/rooms`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: newRoomName,
          gameSystem: newRoomSystem,
          accessType: newRoomAccessType,
          password: newRoomAccessType === 'password' ? newRoomPassword : undefined
        })
      });
      const result = await response.json() as { room?: Room; error?: string };
      if (!response.ok || !result.room) throw new Error(result.error || 'Não foi possível criar a sala.');
      await refreshRooms();
      setActiveRoomId(result.room.id);
      setActivePage('room');
      setNewRoomName('');
      setNewRoomPassword('');
      setMobilePanel('chat');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível criar a sala.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogout = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST', credentials: 'include' });
      if (!response.ok) throw new Error('O servidor não encerrou a sessão.');
      ws?.close();
      setWs(null);
      setConnected(false);
      setUser(null);
      setRooms([]);
      setActiveRoomId(null);
      setActivePage('lobby');
      setSuccessMessage('Sessão encerrada.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível encerrar a sessão.');
    }
  };

  useEffect(() => {
    if (!user || !activeRoomId || !isRoomMember) {
      setWs(null);
      setConnected(false);
      setMessages([]);
      setDiceRolls([]);
      return;
    }

    let socket: WebSocket | null = null;
    let disposed = false;
    let retryTimer: number | undefined;
    let retryAttempt = 0;
    const connect = () => {
      if (disposed) return;
      const wsUrl = new URL(API_BASE);
      wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';
      wsUrl.pathname = '/ws';
      wsUrl.searchParams.set('roomId', activeRoomId);
      socket = new WebSocket(wsUrl.toString());
      setWs(socket);

      socket.onopen = () => {
        retryAttempt = 0;
        setConnected(true);
        setErrorMessage('');
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as {
            type?: string;
            payload?: { messages?: ChatMessage[]; diceRolls?: DiceRoll[]; message?: string };
          };
          if (data.type === 'INIT_STATE' || data.type === 'STATE_UPDATE') {
            if (data.payload?.messages) setMessages(data.payload.messages);
            if (data.payload?.diceRolls) setDiceRolls(data.payload.diceRolls);
          } else if (data.type === 'ERROR') {
            setErrorMessage(data.payload?.message || 'O servidor recusou a ação.');
          }
        } catch {
          setErrorMessage('Não foi possível interpretar a resposta do servidor.');
        }
      };

      socket.onclose = event => {
        setConnected(false);
        if (disposed) return;
        if (event.code === 4003) {
          setErrorMessage('Seu acesso a esta sala foi removido pelo mestre.');
          setActiveRoomId(null);
          setActivePage('lobby');
          refreshRooms().catch(error => setErrorMessage(error instanceof Error ? error.message : 'Não foi possível atualizar as salas.'));
          return;
        }
        const delay = Math.min(1000 * (2 ** retryAttempt), 30000);
        retryAttempt += 1;
        setErrorMessage(`Conexão perdida; tentando reconectar em ${Math.ceil(delay / 1000)} s. A última ação pode não ter sido sincronizada.`);
        retryTimer = window.setTimeout(connect, delay);
      };

      socket.onerror = () => {
        setConnected(false);
        setErrorMessage('Falha na conexão com o backend; a sala tentará reconectar.');
      };
    };
    connect();

    return () => {
      disposed = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      socket?.close();
    };
  }, [user?.id, activeRoomId, isRoomMember]);

  useEffect(() => {
    let active = true;
    if (!user || !activeRoomId || !isRoomMember) {
      setCampaigns([]);
      setCampaignNotes([]);
      setCharacters([]);
      setSelectedCampaignId('');
      return () => { active = false; };
    }
    if (activeRoom?.role === 'spectator') {
      setCampaigns([]);
      setCampaignNotes([]);
      setCharacters([]);
      setSelectedCampaignId('');
      return () => { active = false; };
    }
    Promise.all([
      fetch(`${API_BASE}/api/rooms/${encodeURIComponent(activeRoomId)}/campaigns`, { credentials: 'include' }),
      fetch(`${API_BASE}/api/rooms/${encodeURIComponent(activeRoomId)}/characters`, { credentials: 'include' })
    ]).then(async ([campaignResponse, characterResponse]) => {
      const campaignResult = await campaignResponse.json() as { campaigns?: Campaign[]; error?: string };
      const characterResult = await characterResponse.json() as { characters?: Character[]; error?: string };
      if (!campaignResponse.ok) throw new Error(campaignResult.error || 'Não foi possível carregar as campanhas.');
      if (!characterResponse.ok) throw new Error(characterResult.error || 'Não foi possível carregar as fichas.');
      if (active) {
        const nextCampaigns = campaignResult.campaigns || [];
        setCampaigns(nextCampaigns);
        setSelectedCampaignId(current => nextCampaigns.some(campaign => campaign.id === current) ? current : nextCampaigns[0]?.id || '');
        setCharacters(characterResult.characters || []);
      }
    }).catch(error => {
      if (active) setErrorMessage(error instanceof Error ? error.message : 'Não foi possível carregar campanhas e fichas.');
    });
    return () => { active = false; };
  }, [user?.id, activeRoomId, isRoomMember, activeRoom?.role]);

  useEffect(() => {
    let active = true;
    if (!user || !activeRoomId || !isRoomMember) {
      setLibraryItems([]);
      setSelectedLibraryItemId(null);
      return () => { active = false; };
    }
    fetch(`${API_BASE}/api/rooms/${encodeURIComponent(activeRoomId)}/library`, { credentials: 'include' })
      .then(async response => {
        const result = await response.json() as { items?: LibraryItem[]; error?: string };
        if (!response.ok) throw new Error(result.error || 'Não foi possível carregar a biblioteca.');
        return result.items || [];
      })
      .then(items => {
        if (!active) return;
        setLibraryItems(items);
        setSelectedLibraryItemId(current => items.some(item => item.id === current && item.itemType === 'map') ? current : null);
      })
      .catch(error => {
        if (active) setErrorMessage(error instanceof Error ? error.message : 'Não foi possível carregar a biblioteca.');
      });
    return () => { active = false; };
  }, [user?.id, activeRoomId, isRoomMember]);

  useEffect(() => {
    let active = true;
    if (!activeRoom || activeRoom.role !== 'gm' || !selectedCampaignId) {
      setCampaignNotes([]);
      return () => { active = false; };
    }
    fetch(`${API_BASE}/api/campaigns/${encodeURIComponent(selectedCampaignId)}/notes`, { credentials: 'include' })
      .then(async response => {
        const result = await response.json() as { notes?: CampaignNote[]; error?: string };
        if (!response.ok) throw new Error(result.error || 'Não foi possível carregar as notas.');
        return result;
      })
      .then(result => { if (active) setCampaignNotes(result.notes || []); })
      .catch(error => { if (active) setErrorMessage(error instanceof Error ? error.message : 'Não foi possível carregar as notas.'); });
    return () => { active = false; };
  }, [activeRoom?.role, selectedCampaignId]);

  useEffect(() => {
    let active = true;
    if (!user || !activeRoomId || !isRoomMember) {
      setRoomMembers([]);
      setBannedMembers([]);
      return () => { active = false; };
    }
    fetch(`${API_BASE}/api/rooms/${encodeURIComponent(activeRoomId)}`, { credentials: 'include' })
      .then(async response => {
        const result = await response.json() as { members?: RoomMember[]; bannedMembers?: Array<{ id: string; username: string; reason: string }>; error?: string };
        if (!response.ok) throw new Error(result.error || 'Não foi possível carregar os membros da sala.');
        return result;
      })
      .then(result => {
        if (active) {
          setRoomMembers(result.members || []);
          setBannedMembers(result.bannedMembers || []);
        }
      })
      .catch(error => {
        if (active) setErrorMessage(error instanceof Error ? error.message : 'Não foi possível carregar os membros.');
      });
    return () => { active = false; };
  }, [user?.id, activeRoomId, isRoomMember, activeTab]);

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    const text = inputMessage.trim();
    if (!text) return;
    if (text.length > 500) {
      setErrorMessage('A mensagem pode ter no máximo 500 caracteres.');
      return;
    }

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setErrorMessage('Sala desconectada. A mensagem não foi enviada.');
      return;
    }
    ws.send(JSON.stringify({ type: 'SEND_CHAT', payload: { text } }));
    setInputMessage('');
    setErrorMessage('');
  };

  const handleRollDice = (expr: string) => {
    if (activeRoom?.role === 'spectator') {
      setErrorMessage('Espectadores podem conversar, mas não rolar dados.');
      return;
    }
    const match = /^([1-9]\d?)d([1-9]\d{0,3})([+-]\d{1,3})?$/.exec(expr.trim());
    const count = match ? Number(match[1]) : 0;
    const sides = match ? Number(match[2]) : 0;
    const modifier = match ? Number(match[3] || 0) : 0;
    if (!match || count > 20 || sides > 1000 || Math.abs(modifier) > 100) {
      setErrorMessage('Use uma expressão como 2d6+3 (até 20 dados, d1000 e modificador ±100).');
      return;
    }

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setErrorMessage('Sala desconectada. A rolagem não foi enviada ao servidor.');
      return;
    }
    ws.send(JSON.stringify({ type: 'ROLL_DICE', payload: { expression: expr.trim() } }));
    setErrorMessage('');
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
      setIsFullscreen(Boolean(document.fullscreenElement));
    } catch {
      setErrorMessage('O navegador não permitiu alternar para tela cheia.');
    }
  };

  const handleInstall = async () => {
    if (!installPrompt) return;
    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === 'accepted') setSuccessMessage('Instalação do FREECAST iniciada.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? `Não foi possível iniciar a instalação: ${error.message}` : 'Não foi possível iniciar a instalação.');
    } finally {
      setInstallPrompt(null);
    }
  };

  const visibleRooms = rooms.filter(room => `${room.name} ${room.gameSystem} ${room.description}`.toLocaleLowerCase().includes(roomSearch.trim().toLocaleLowerCase()));

  return (
    <div className="flex h-[100dvh] min-h-[420px] flex-col overflow-hidden bg-[#101113] font-sans text-[#D0CCC4]">
      <header className="z-10 flex shrink-0 flex-col gap-2 border-b border-[#A88956]/30 bg-gradient-to-r from-[#292A2E] via-[#292A2E] to-[#17181A] px-3 py-2 shadow-lg sm:flex-row sm:items-center sm:justify-between sm:px-4">
        <div className="flex items-center space-x-3">
          <div className="rounded border border-[#A88956]/60 bg-[#101113]/60 p-2 shadow-inner">
            <Dices className="h-5 w-5 text-[#A88956]" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-[0.16em] text-[#E3D8C6]">FREECAST</h1>
            <p className="text-[10px] uppercase tracking-[0.18em] text-[#A88956]/80">VTT independente</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-4">
          <nav aria-label="Navegação principal" className="flex items-center gap-1">
            <button type="button" onClick={() => setActivePage('lobby')} aria-current={activePage === 'lobby' ? 'page' : undefined} className={`rounded border px-3 py-2 text-xs transition ${activePage === 'lobby' ? 'border-[#A88956] bg-[#101113]/80 text-[#E3D8C6]' : 'border-transparent text-[#D0CCC4]/70 hover:border-[#A88956]/40'}`}>
              <Home className="mr-1 inline h-4 w-4" aria-hidden="true" />Lobby
            </button>
            <button type="button" onClick={() => activeRoomId && isRoomMember && setActivePage('room')} disabled={!activeRoomId || !isRoomMember} aria-current={activePage === 'room' ? 'page' : undefined} className={`rounded border px-3 py-2 text-xs transition disabled:cursor-not-allowed disabled:opacity-40 ${activePage === 'room' ? 'border-[#A88956] bg-[#101113]/80 text-[#E3D8C6]' : 'border-transparent text-[#D0CCC4]/70 hover:border-[#A88956]/40'}`}>
              Mesa
            </button>
            <button type="button" onClick={() => activeRoomId && isRoomMember && activeRoom?.role !== 'spectator' && setActivePage('campaigns')} disabled={!activeRoomId || !isRoomMember || activeRoom?.role === 'spectator'} aria-current={activePage === 'campaigns' ? 'page' : undefined} className={`rounded border px-3 py-2 text-xs transition disabled:cursor-not-allowed disabled:opacity-40 ${activePage === 'campaigns' ? 'border-[#A88956] bg-[#101113]/80 text-[#E3D8C6]' : 'border-transparent text-[#D0CCC4]/70 hover:border-[#A88956]/40'}`}>
              Campanhas
            </button>
            <button type="button" onClick={() => activeRoomId && isRoomMember && activeRoom?.role !== 'spectator' && setActivePage('characters')} disabled={!activeRoomId || !isRoomMember || activeRoom?.role === 'spectator'} aria-current={activePage === 'characters' ? 'page' : undefined} className={`rounded border px-3 py-2 text-xs transition disabled:cursor-not-allowed disabled:opacity-40 ${activePage === 'characters' ? 'border-[#A88956] bg-[#101113]/80 text-[#E3D8C6]' : 'border-transparent text-[#D0CCC4]/70 hover:border-[#A88956]/40'}`}>
              Fichas
            </button>
          </nav>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-2 rounded border border-[#A88956]/40 bg-[#101113]/80 px-3 py-2 text-xs" role="status">
              <span className={`h-2.5 w-2.5 rounded-full ${connected ? 'bg-emerald-500' : 'bg-amber-500'}`} aria-hidden="true"></span>
              {!isOnline ? 'Sem rede · alterações não sincronizadas' : connected ? `${activeRoom?.name || 'Sala'} · backend conectado` : user && activeRoomId ? 'Backend desconectado' : user ? 'Conecte-se a uma sala' : 'Entre para jogar'}
            </span>
            {user && <><span className="max-w-28 truncate text-xs text-[#E3D8C6]">{user.username}</span><button type="button" onClick={handleLogout} className="min-h-9 rounded border border-[#A88956]/40 px-2 text-xs text-[#D0CCC4] hover:border-[#A88956]">Sair</button></>}
            {installPrompt && <button type="button" onClick={handleInstall} className="min-h-9 rounded border border-[#A88956]/50 px-2 text-xs text-[#E3D8C6]">Instalar app</button>}
            <button type="button" onClick={toggleFullscreen} aria-label={isFullscreen ? 'Sair da tela cheia' : 'Entrar em tela cheia'} aria-pressed={isFullscreen} className="rounded border border-[#A88956]/40 bg-[#542126] p-2 text-[#A88956] shadow transition hover:bg-[#722E34]">
              <Maximize2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      {errorMessage && <div role="alert" className="shrink-0 border-b border-amber-700/60 bg-amber-950/70 px-4 py-2 text-sm text-amber-100">{errorMessage}</div>}
      {successMessage && <div role="status" className="shrink-0 border-b border-emerald-700/60 bg-emerald-950/70 px-4 py-2 text-sm text-emerald-100">{successMessage}</div>}

      {activePage !== 'room' ? (
        <main className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-8">
          <div className="mx-auto max-w-5xl">
            {activePage === 'lobby' && <div className="mb-5 border-b border-[#A88956]/30 pb-3">
              <p className="mb-1 text-xs uppercase tracking-[0.18em] text-[#A88956]/80">Procurar mesas</p>
              <h2 className="text-2xl font-bold text-[#E3D8C6] sm:text-3xl">Mesas virtuais</h2>
              <p className="mt-2 max-w-2xl text-sm text-[#D0CCC4]/70">Entre em uma mesa pública ou crie a sua. Contas e partidas são compartilhadas pelo servidor configurado.</p>
            </div>}
            {!authLoaded ? <p role="status" className="rounded border border-[#A88956]/20 bg-[#202124] p-5 text-sm">Verificando sessão no servidor…</p> : !user ? (
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
                <section className="rounded-lg border border-[#A88956]/30 bg-[#202124] p-5">
                  <p className="text-xs uppercase tracking-widest text-[#A88956]">Conta do servidor</p>
                  <h3 className="mt-2 text-xl font-semibold text-[#E3D8C6]">{authMode === 'login' ? 'Entrar na mesa' : 'Criar conta'}</h3>
                  <p className="mt-2 text-sm text-[#D0CCC4]/70">A senha é armazenada como hash no servidor. O cadastro não envia e-mail de verificação.</p>
                  <form onSubmit={handleAuthSubmit} className="mt-5 space-y-4">
                    <label className="block text-sm text-[#E3D8C6]">{authMode === 'login' ? 'E-mail ou nome de usuário' : 'Nome de usuário'}
                      <input required minLength={authMode === 'register' ? 3 : 1} maxLength={254} autoComplete={authMode === 'register' ? 'username' : 'username'} value={authUsername} onChange={event => setAuthUsername(event.target.value)} className="mt-1 min-h-11 w-full rounded border border-[#A88956]/40 bg-[#101113] px-3 text-sm" />
                    </label>
                    {authMode === 'register' && <label className="block text-sm text-[#E3D8C6]">E-mail
                      <input required type="email" maxLength={254} autoComplete="email" value={authEmail} onChange={event => setAuthEmail(event.target.value)} className="mt-1 min-h-11 w-full rounded border border-[#A88956]/40 bg-[#101113] px-3 text-sm" />
                    </label>}
                    <label className="block text-sm text-[#E3D8C6]">Senha
                      <input required minLength={authMode === 'register' ? 12 : 1} maxLength={128} type="password" autoComplete={authMode === 'register' ? 'new-password' : 'current-password'} value={authPassword} onChange={event => setAuthPassword(event.target.value)} className="mt-1 min-h-11 w-full rounded border border-[#A88956]/40 bg-[#101113] px-3 text-sm" />
                    </label>
                    <button disabled={isSubmitting} type="submit" className="min-h-11 w-full rounded border border-[#A88956]/60 bg-[#542126] px-4 font-semibold text-[#E3D8C6] disabled:opacity-50">{isSubmitting ? 'Aguarde…' : authMode === 'login' ? 'Entrar' : 'Criar conta'}</button>
                  </form>
                  <button type="button" onClick={() => setAuthMode(mode => mode === 'login' ? 'register' : 'login')} className="mt-4 text-sm text-[#A88956] underline underline-offset-4">
                    {authMode === 'login' ? 'Ainda não tenho conta' : 'Já tenho uma conta'}
                  </button>
                </section>
                <aside className="rounded-lg border border-[#A88956]/20 bg-[#101113] p-5 text-sm text-[#D0CCC4]/70">
                  <h3 className="font-semibold text-[#E3D8C6]">Salas persistidas</h3>
                  <p className="mt-2">O lobby lista apenas salas armazenadas no servidor. A presença online em tempo real ainda não é anunciada.</p>
                  {errorMessage && <p className="mt-4 text-amber-200">Estado do servidor: {errorMessage}</p>}
                </aside>
              </div>
            ) : activePage === 'campaigns' ? (
              <section className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-8">
                <div className="mx-auto max-w-5xl">
                  <p className="mb-1 text-xs uppercase tracking-[0.25em] text-[#A88956]/80">{activeRoom?.name || 'Sala'}</p>
                  <h2 className="mb-6 border-b border-[#A88956]/30 pb-4 text-2xl font-bold text-[#E3D8C6]">Campanhas e anotações</h2>
                  {activeRoom?.role === 'gm' && (
                    <form onSubmit={handleSaveCampaign} className="mb-6 grid gap-3 rounded-lg border border-[#A88956]/30 bg-[#202124] p-4">
                      <h3 className="font-semibold text-[#E3D8C6]">{editingCampaignId ? 'Editar campanha' : 'Nova campanha'}</h3>
                      <label className="text-sm text-[#E3D8C6]">Nome
                        <input required maxLength={100} value={campaignName} onChange={event => setCampaignName(event.target.value)} className="mt-1 min-h-11 w-full rounded border border-[#A88956]/40 bg-[#101113] px-3" />
                      </label>
                      <label className="text-sm text-[#E3D8C6]">Descrição
                        <textarea maxLength={1000} value={campaignDescription} onChange={event => setCampaignDescription(event.target.value)} className="mt-1 min-h-20 w-full rounded border border-[#A88956]/40 bg-[#101113] p-3" />
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <button type="submit" className="min-h-10 rounded border border-[#A88956]/60 bg-[#542126] px-4 font-semibold text-[#E3D8C6]">{editingCampaignId ? 'Salvar alterações' : 'Criar campanha'}</button>
                        {editingCampaignId && <button type="button" onClick={() => { setEditingCampaignId(null); setCampaignName(''); setCampaignDescription(''); }} className="min-h-10 rounded border border-[#A88956]/30 px-4 text-sm">Cancelar</button>}
                      </div>
                    </form>
                  )}
                  <div className="grid gap-4 lg:grid-cols-2">
                    <section className="space-y-3">
                      {campaigns.map(campaign => (
                        <article key={campaign.id} className={`rounded-lg border bg-[#202124] p-4 ${selectedCampaignId === campaign.id ? 'border-[#A88956]' : 'border-[#A88956]/25'}`}>
                          <button type="button" onClick={() => setSelectedCampaignId(campaign.id)} className="w-full text-left">
                            <h3 className="font-semibold text-[#E3D8C6]">{campaign.name}</h3>
                            <p className="mt-1 whitespace-pre-wrap text-sm text-[#D0CCC4]/70">{campaign.description || 'Sem descrição.'}</p>
                          </button>
                          {activeRoom?.role === 'gm' && <div className="mt-3 flex gap-2">
                            <button type="button" onClick={() => { setEditingCampaignId(campaign.id); setCampaignName(campaign.name); setCampaignDescription(campaign.description); }} className="min-h-9 rounded border border-[#A88956]/30 px-3 text-xs">Editar</button>
                            <button type="button" onClick={() => handleDeleteCampaign(campaign.id)} className="min-h-9 rounded border border-red-800/60 px-3 text-xs text-red-200">Excluir</button>
                          </div>}
                        </article>
                      ))}
                      {campaigns.length === 0 && <p className="rounded border border-[#A88956]/20 p-4 text-sm text-[#D0CCC4]/70">Ainda não há campanhas nesta sala.</p>}
                    </section>
                    <section className="rounded-lg border border-[#A88956]/25 bg-[#202124] p-4">
                      <label className="block text-sm text-[#E3D8C6]">Campanha selecionada
                        <select value={selectedCampaignId} onChange={event => setSelectedCampaignId(event.target.value)} className="mt-1 min-h-11 w-full rounded border border-[#A88956]/40 bg-[#101113] px-3">
                          <option value="">Selecione uma campanha</option>
                          {campaigns.map(campaign => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
                        </select>
                      </label>
                      {activeRoom?.role === 'gm' && selectedCampaignId ? (
                        <>
                          <form onSubmit={handleSaveNote} className="mt-4 space-y-3 border-b border-[#A88956]/20 pb-4">
                            <h3 className="font-semibold text-[#E3D8C6]">{editingNoteId ? 'Editar anotação' : 'Nova anotação privada do mestre'}</h3>
                            <input required maxLength={120} value={noteTitle} onChange={event => setNoteTitle(event.target.value)} placeholder="Título" aria-label="Título da anotação" className="min-h-10 w-full rounded border border-[#A88956]/40 bg-[#101113] px-3 text-sm" />
                            <textarea maxLength={10000} value={noteContent} onChange={event => setNoteContent(event.target.value)} placeholder="Anotação (visível somente ao mestre)" aria-label="Conteúdo da anotação" className="min-h-28 w-full rounded border border-[#A88956]/40 bg-[#101113] p-3 text-sm" />
                            <div className="flex gap-2">
                              <button type="submit" className="min-h-10 rounded border border-[#A88956]/60 bg-[#542126] px-4 text-sm text-[#E3D8C6]">Salvar anotação</button>
                              {editingNoteId && <button type="button" onClick={() => { setEditingNoteId(null); setNoteTitle(''); setNoteContent(''); }} className="min-h-10 rounded border border-[#A88956]/30 px-3 text-xs">Cancelar</button>}
                            </div>
                          </form>
                          <div className="mt-4 space-y-3">
                            {campaignNotes.map(note => <article key={note.id} className="rounded border border-[#A88956]/20 bg-[#101113]/70 p-3">
                              <h4 className="font-semibold text-[#E3D8C6]">{note.title}</h4>
                              <p className="mt-2 whitespace-pre-wrap text-sm text-[#D0CCC4]/80">{note.content}</p>
                              <div className="mt-2 flex gap-2">
                                <button type="button" onClick={() => { setEditingNoteId(note.id); setNoteTitle(note.title); setNoteContent(note.content); }} className="min-h-9 rounded border border-[#A88956]/30 px-3 text-xs">Editar</button>
                                <button type="button" onClick={() => handleDeleteNote(note.id)} className="min-h-9 rounded border border-red-800/60 px-3 text-xs text-red-200">Excluir</button>
                              </div>
                            </article>)}
                            {campaignNotes.length === 0 && <p className="text-sm text-[#D0CCC4]/60">Nenhuma anotação nesta campanha.</p>}
                          </div>
                        </>
                      ) : <p className="mt-4 text-sm text-[#D0CCC4]/60">{activeRoom?.role === 'gm' ? 'Selecione uma campanha para gerenciar anotações.' : 'As anotações são privadas do mestre.'}</p>}
                    </section>
                  </div>
                </div>
              </section>
            ) : activePage === 'characters' ? (
              <section className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-8">
                <div className="mx-auto max-w-5xl">
                  <p className="mb-1 text-xs uppercase tracking-[0.25em] text-[#A88956]/80">{activeRoom?.name || 'Sala'}</p>
                  <h2 className="mb-6 border-b border-[#A88956]/30 pb-4 text-2xl font-bold text-[#E3D8C6]">Fichas de personagem</h2>
                  {(activeRoom?.role === 'gm' || editingCharacterId) && <form onSubmit={handleSaveCharacter} className="mb-6 grid gap-3 rounded-lg border border-[#A88956]/30 bg-[#202124] p-4 lg:grid-cols-2">
                    <h3 className="font-semibold text-[#E3D8C6] lg:col-span-2">{editingCharacterId ? 'Editar ficha' : 'Criar ficha'}</h3>
                    <label className="text-sm text-[#E3D8C6]">Nome
                      <input required maxLength={60} value={characterName} onChange={event => setCharacterName(event.target.value)} className="mt-1 min-h-11 w-full rounded border border-[#A88956]/40 bg-[#101113] px-3" />
                    </label>
                    <label className="text-sm text-[#E3D8C6]">Campanha
                      <select value={characterCampaignId} onChange={event => setCharacterCampaignId(event.target.value)} className="mt-1 min-h-11 w-full rounded border border-[#A88956]/40 bg-[#101113] px-3">
                        <option value="">Sem campanha</option>
                        {campaigns.map(campaign => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
                      </select>
                    </label>
                    {!editingCharacterId && activeRoom?.role === 'gm' && <label className="text-sm text-[#E3D8C6]">Atribuir ficha
                      <select value={characterOwnerId} onChange={event => setCharacterOwnerId(event.target.value)} className="mt-1 min-h-11 w-full rounded border border-[#A88956]/40 bg-[#101113] px-3">
                        <option value="">Mestre (minha ficha)</option>
                        {roomMembers.filter(member => member.role === 'player').map(member => <option key={member.id} value={member.id}>{member.username}</option>)}
                      </select>
                    </label>}
                    <label className="text-sm text-[#E3D8C6] lg:col-span-2">Dados JSON da ficha
                      <textarea required value={characterDataText} onChange={event => setCharacterDataText(event.target.value)} spellCheck={false} className="mt-1 min-h-36 w-full rounded border border-[#A88956]/40 bg-[#101113] p-3 font-mono text-xs" />
                    </label>
                    <div className="flex gap-2 lg:col-span-2">
                      <button type="submit" className="min-h-10 rounded border border-[#A88956]/60 bg-[#542126] px-4 font-semibold text-[#E3D8C6]">{editingCharacterId ? 'Salvar ficha' : 'Criar ficha'}</button>
                      {editingCharacterId && <button type="button" onClick={() => { setEditingCharacterId(null); setCharacterName(''); setCharacterDataText(DEFAULT_DND5E_CHARACTER); setCharacterCampaignId(''); setCharacterOwnerId(''); }} className="min-h-10 rounded border border-[#A88956]/30 px-4 text-sm">Cancelar</button>}
                    </div>
                  </form>}
                  <div className="grid gap-4 md:grid-cols-2">
                    {characters.map(character => <article key={character.id} className="rounded-lg border border-[#A88956]/25 bg-[#202124] p-4">
                      <h3 className="font-semibold text-[#E3D8C6]">{character.name}</h3>
                      <p className="mt-1 text-xs text-[#D0CCC4]/60">{campaigns.find(campaign => campaign.id === character.campaignId)?.name || 'Sem campanha'} · {character.ownerUserId === user?.id ? 'Sua ficha' : 'Ficha de jogador'}</p>
                      {getDnd5eAbilities(character.data).length > 0 && <div className="mt-3">
                        <p className="mb-2 text-[10px] uppercase tracking-wider text-[#A88956]/80">Testes D&D 5E · resultado calculado no servidor</p>
                        <div className="grid grid-cols-3 gap-1">
                          {getDnd5eAbilities(character.data).map(([ability, score]) => <div key={ability} className="flex items-center gap-1">
                            <button type="button" disabled={activeRoom?.role === 'spectator'} onClick={() => handleCharacterCheck(character.id, 'ability', ability)} className="min-h-9 flex-1 rounded border border-[#A88956]/30 bg-[#101113] px-2 text-[10px] uppercase text-[#E3D8C6] disabled:opacity-40">{ability} {score}</button>
                            <button type="button" disabled={activeRoom?.role === 'spectator'} aria-label={`Rolar teste de resistência ${ability}`} onClick={() => handleCharacterCheck(character.id, 'savingThrow', ability)} className="min-h-9 rounded border border-[#A88956]/30 px-2 text-[10px] text-[#A88956] disabled:opacity-40">TR</button>
                          </div>)}
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-1">
                          {DND5E_SKILLS.map(skill => <button key={skill} type="button" disabled={activeRoom?.role === 'spectator'} onClick={() => handleCharacterCheck(character.id, 'skill', skill)} className="min-h-8 rounded border border-[#A88956]/20 bg-[#101113]/70 px-2 text-left text-[10px] capitalize text-[#D0CCC4] disabled:opacity-40">{skill.replace(/[A-Z]/g, letter => ` ${letter.toLowerCase()}`)}</button>)}
                        </div>
                      </div>}
                      <pre className="mt-3 max-h-48 overflow-auto rounded bg-[#101113] p-3 text-xs text-[#D0CCC4]">{JSON.stringify(character.data, null, 2)}</pre>
                      {(character.ownerUserId === user?.id || activeRoom?.role === 'gm') && <div className="mt-3 flex gap-2">
                        <button type="button" onClick={() => { setEditingCharacterId(character.id); setCharacterName(character.name); setCharacterDataText(JSON.stringify(character.data, null, 2)); setCharacterCampaignId(character.campaignId || ''); }} className="min-h-9 rounded border border-[#A88956]/30 px-3 text-xs">Editar</button>
                        <button type="button" onClick={() => handleDeleteCharacter(character.id)} className="min-h-9 rounded border border-red-800/60 px-3 text-xs text-red-200">Excluir</button>
                      </div>}
                    </article>)}
                    {characters.length === 0 && <p className="rounded border border-[#A88956]/20 p-4 text-sm text-[#D0CCC4]/70">Você ainda não tem fichas nesta sala.</p>}
                  </div>
                </div>
              </section>
            ) : (
              <>
                <form onSubmit={handleCreateRoom} className="mb-8 grid gap-3 rounded-lg border border-[#A88956]/30 bg-[#202124] p-4 md:grid-cols-2">
                  <label className="text-sm text-[#E3D8C6]">Nome da sala
                    <input required maxLength={80} value={newRoomName} onChange={event => setNewRoomName(event.target.value)} placeholder="Ex.: Crônicas do Norte" className="mt-1 min-h-11 w-full rounded border border-[#A88956]/40 bg-[#101113] px-3" />
                  </label>
                  <label className="text-sm text-[#E3D8C6]">Sistema
                    <input maxLength={60} value={newRoomSystem} onChange={event => setNewRoomSystem(event.target.value)} className="mt-1 min-h-11 w-full rounded border border-[#A88956]/40 bg-[#101113] px-3" />
                  </label>
                  <label className="text-sm text-[#E3D8C6]">Acesso da sala
                    <select value={newRoomAccessType} onChange={event => setNewRoomAccessType(event.target.value as 'public' | 'password')} className="mt-1 min-h-11 w-full rounded border border-[#A88956]/40 bg-[#101113] px-3">
                      <option value="public">Pública</option>
                      <option value="password">Protegida por senha</option>
                    </select>
                  </label>
                  {newRoomAccessType === 'password' && <label className="text-sm text-[#E3D8C6]">Senha da sala
                    <input required minLength={6} maxLength={128} type="password" autoComplete="new-password" value={newRoomPassword} onChange={event => setNewRoomPassword(event.target.value)} className="mt-1 min-h-11 w-full rounded border border-[#A88956]/40 bg-[#101113] px-3" />
                  </label>}
                  <button disabled={isSubmitting} type="submit" className="min-h-11 self-end rounded border border-[#A88956]/60 bg-[#542126] px-5 font-semibold text-[#E3D8C6] disabled:opacity-50">Criar sala</button>
                </form>
                <label htmlFor="room-search" className="mb-2 block text-sm text-[#E3D8C6]">Buscar nas salas disponíveis</label>
                <input id="room-search" type="search" value={roomSearch} onChange={event => setRoomSearch(event.target.value)} placeholder="Nome, sistema ou descrição" className="mb-6 w-full max-w-lg rounded border border-[#A88956]/40 bg-[#191A1D] px-3 py-3 text-sm text-[#D0CCC4] placeholder:text-[#D0CCC4]/40 focus:border-[#A88956] focus:outline-none focus:ring-2 focus:ring-[#A88956]/30" />
                <div className="space-y-2">
                  {visibleRooms.map(room => (
                    <article key={room.id} className="rounded border border-[#A88956]/25 bg-[#202124] p-3 transition hover:border-[#A88956]/60">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="hidden h-12 w-12 shrink-0 items-center justify-center rounded border border-[#A88956]/25 bg-[#101113] sm:flex" aria-hidden="true">
                            <Dices className="h-5 w-5 text-[#A88956]" />
                          </div>
                          <div className="min-w-0">
                            <h3 className="text-lg font-semibold text-[#E3D8C6]">{room.name}</h3>
                            <p className="mt-1 text-xs text-[#A88956]">{room.gameSystem}</p>
                            {room.description && <p className="mt-1 text-sm text-[#D0CCC4]/70">{room.description}</p>}
                          </div>
                        </div>
                        <span className="shrink-0 rounded border border-[#A88956]/20 px-2 py-1 text-xs text-[#D0CCC4]/70">{room.role ? room.role === 'gm' ? 'Mestre' : room.role === 'player' ? 'Jogador' : 'Espectador' : room.requiresPassword ? 'Requer senha' : 'Pública'}</span>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-3 border-t border-[#A88956]/15 pt-2">
                        <span className="text-xs text-[#D0CCC4]/60">{room.memberCount} membro(s)</span>
                        <button disabled={isSubmitting} type="button" onClick={() => room.role ? (setActiveRoomId(room.id), setActivePage('room'), setMobilePanel('chat')) : room.requiresPassword ? setJoiningRoom(room) : handleJoinRoom(room)} className="min-h-10 rounded border border-[#A88956]/60 bg-[#542126] px-4 text-sm font-semibold text-[#E3D8C6] disabled:opacity-50">{room.role ? 'Abrir sala' : room.requiresPassword ? 'Informar senha' : 'Entrar na sala'}</button>
                      </div>
                    </article>
                  ))}
                </div>
                {visibleRooms.length === 0 && <p className="rounded border border-[#A88956]/20 bg-[#202124] p-5 text-sm text-[#D0CCC4]/70">{rooms.length === 0 ? 'Nenhuma sala disponível.' : 'Nenhuma sala corresponde à busca.'}</p>}
                {joiningRoom && <form onSubmit={event => { event.preventDefault(); void handleJoinRoom(joiningRoom); }} className="mt-5 max-w-lg rounded-lg border border-[#A88956]/40 bg-[#202124] p-4">
                  <h3 className="font-semibold text-[#E3D8C6]">Entrar em {joiningRoom.name}</h3>
                  <label className="mt-3 block text-sm text-[#E3D8C6]">Senha da mesa
                    <input required type="password" autoComplete="current-password" value={joinPassword} onChange={event => setJoinPassword(event.target.value)} className="mt-1 min-h-11 w-full rounded border border-[#A88956]/40 bg-[#101113] px-3" />
                  </label>
                  <div className="mt-3 flex gap-2">
                    <button disabled={isSubmitting} type="submit" className="min-h-10 rounded border border-[#A88956]/60 bg-[#542126] px-4 text-sm">Entrar</button>
                    <button type="button" onClick={() => { setJoiningRoom(null); setJoinPassword(''); }} className="min-h-10 rounded border border-[#A88956]/30 px-4 text-sm">Cancelar</button>
                  </div>
                </form>}
              </>
            )}
          </div>
        </main>
      ) : (
      <>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Left Sidebar: Participants & Characters */}
        <aside className={`${mobilePanel === 'library' ? 'flex' : 'hidden'} w-full shrink-0 flex-col bg-[#202124] md:flex md:w-64 md:border-r md:border-[#A88956]/20`}>
          <div className="p-4 border-b border-[#A88956]/20 bg-[#292A2E]">
            <h2 className="text-sm font-semibold tracking-wider text-[#A88956] uppercase flex items-center space-x-2">
              <Compass className="w-4 h-4" />
              <span>Biblioteca</span>
            </h2>
            <p className="mt-1 text-xs text-[#D0CCC4]/60">{activeRoom?.name || 'Sala'}</p>
          </div>
          <nav aria-label="Biblioteca da mesa" className="space-y-1 border-b border-[#A88956]/20 p-2">
            <button type="button" disabled={activeRoom?.role === 'spectator'} onClick={() => setActivePage('campaigns')} className="flex min-h-9 w-full items-center gap-2 rounded px-2 text-left text-xs text-[#D0CCC4]/80 hover:bg-[#292A2E] disabled:opacity-40">
              <Home className="h-4 w-4" aria-hidden="true" /> Campanhas <span className="ml-auto text-[#A88956]">{campaigns.length}</span>
            </button>
            <button type="button" disabled={activeRoom?.role === 'spectator'} onClick={() => setActivePage('characters')} className="flex min-h-9 w-full items-center gap-2 rounded px-2 text-left text-xs text-[#D0CCC4]/80 hover:bg-[#292A2E] disabled:opacity-40">
              <Users className="h-4 w-4" aria-hidden="true" /> Fichas <span className="ml-auto text-[#A88956]">{characters.length}</span>
            </button>
          </nav>
          {activeRoom?.role === 'gm' && <form onSubmit={handleSaveLibraryItem} className="space-y-2 border-b border-[#A88956]/20 p-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#A88956]">Criar item</h3>
            <input required maxLength={80} value={libraryName} onChange={event => setLibraryName(event.target.value)} placeholder="Nome" aria-label="Nome do item" className="min-h-9 w-full rounded border border-[#A88956]/30 bg-[#101113] px-2 text-xs" />
            <div className="grid grid-cols-2 gap-2">
              <select aria-label="Tipo do item" value={libraryItemType} onChange={event => setLibraryItemType(event.target.value as 'folder' | 'map')} className="min-h-9 rounded border border-[#A88956]/30 bg-[#101113] px-2 text-xs">
                <option value="folder">Pasta</option>
                <option value="map">Mapa/grid</option>
              </select>
              <select aria-label="Visibilidade do item" value={libraryVisibility} onChange={event => setLibraryVisibility(event.target.value as 'private' | 'room')} className="min-h-9 rounded border border-[#A88956]/30 bg-[#101113] px-2 text-xs">
                <option value="room">Todos na sala</option>
                <option value="private">Só mestre</option>
              </select>
            </div>
            <select aria-label="Pasta do item" value={libraryParentId} onChange={event => setLibraryParentId(event.target.value)} className="min-h-9 w-full rounded border border-[#A88956]/30 bg-[#101113] px-2 text-xs">
              <option value="">Raiz da biblioteca</option>
              {libraryItems.filter(item => item.itemType === 'folder').map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
            </select>
            {libraryItemType === 'map' && <>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[10px] text-[#D0CCC4]/70">Colunas
                  <input type="number" min={1} max={100} value={libraryWidth} onChange={event => setLibraryWidth(Number(event.target.value))} className="mt-1 min-h-9 w-full rounded border border-[#A88956]/30 bg-[#101113] px-2 text-xs" />
                </label>
                <label className="text-[10px] text-[#D0CCC4]/70">Linhas
                  <input type="number" min={1} max={100} value={libraryHeight} onChange={event => setLibraryHeight(Number(event.target.value))} className="mt-1 min-h-9 w-full rounded border border-[#A88956]/30 bg-[#101113] px-2 text-xs" />
                </label>
              </div>
              <input type="url" maxLength={2048} value={libraryBackgroundUrl} onChange={event => setLibraryBackgroundUrl(event.target.value)} placeholder="URL HTTPS da imagem de fundo" aria-label="URL da imagem de fundo do mapa" className="min-h-9 w-full rounded border border-[#A88956]/30 bg-[#101113] px-2 text-xs" />
            </>}
            <button type="submit" className="min-h-9 w-full rounded border border-[#A88956]/50 bg-[#542126] px-3 text-xs font-semibold text-[#E3D8C6]">Salvar na biblioteca</button>
          </form>}
          <div className="flex-1 space-y-2 overflow-y-auto p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#A88956]/80">Itens da mesa · {libraryItems.length}</p>
            {libraryItems.map(item => <article key={item.id} className={`rounded border p-2 ${selectedLibraryItemId === item.id ? 'border-[#A88956] bg-[#542126]/40' : 'border-[#A88956]/20 bg-[#101113]/60'}`}>
              <button type="button" onClick={() => {
                if (item.itemType === 'map') {
                  setSelectedLibraryItemId(item.id);
                  setMobilePanel('map');
                } else {
                  setLibraryParentId(item.id);
                  setLibraryItemType('folder');
                }
              }} aria-pressed={selectedLibraryItemId === item.id} className="w-full text-left text-xs">
                <span className="mr-2 text-[#A88956]">{item.itemType === 'folder' ? '▸' : '▦'}</span>
                <span className="font-semibold text-[#E3D8C6]">{item.name}</span>
                <span className="ml-1 text-[10px] text-[#D0CCC4]/50">{item.visibility === 'private' ? '· privado' : ''}</span>
                {item.itemType === 'map' && <span className="mt-1 block text-[10px] text-[#D0CCC4]/50">{item.data.width} × {item.data.height}</span>}
              </button>
              {activeRoom?.role === 'gm' && <button type="button" onClick={() => void handleDeleteLibraryItem(item)} className="mt-2 min-h-8 rounded border border-red-800/50 px-2 text-[10px] text-red-200">Excluir</button>}
            </article>)}
            {libraryItems.length === 0 && <p className="rounded border border-[#A88956]/20 p-3 text-xs text-[#D0CCC4]/60">{activeRoom?.role === 'spectator' ? 'Espectadores não têm acesso à biblioteca.' : 'A biblioteca ainda está vazia.'}</p>}
          </div>
        </aside>

        {/* Center: Tactical Map Grid */}
        <main className={`${mobilePanel === 'map' || mobilePanel === 'chat' || mobilePanel === 'dice' ? 'flex' : 'hidden'} relative min-w-0 flex-1 flex-col overflow-hidden bg-[#101113] md:flex`}>
          <div className="absolute inset-0 bg-[radial-gradient(#35373A_1px,transparent_1px)] [background-size:24px_24px] opacity-30"></div>
          
          <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto p-2 sm:p-6">
            {mobilePanel !== 'map' && mobilePanel !== 'dice' ? <div className="flex h-full min-h-0 w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-[#A88956]/30 bg-[#191A1D]/90 shadow-xl">
              <div className="flex items-center justify-between border-b border-[#A88956]/20 bg-[#292A2E] px-4 py-3">
                <div>
                  <h2 className="font-semibold text-[#E3D8C6]">Chat da mesa</h2>
                  <p className="text-[10px] text-[#D0CCC4]/50">Mensagens persistidas pelo servidor</p>
                </div>
                <span className="text-xs text-[#D0CCC4]/50">{messages.length}</span>
              </div>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 sm:p-5">
                {messages.map(message => <article key={message.id} className="rounded border border-[#A88956]/20 bg-[#101113]/80 p-3">
                  <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-[#A88956]">{message.user}</span>
                    <time className="font-mono text-[10px] text-[#D0CCC4]/40">{message.time}</time>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm text-[#D0CCC4]">{message.text}</p>
                </article>)}
                {messages.length === 0 && <p className="rounded border border-dashed border-[#A88956]/20 p-5 text-center text-sm text-[#D0CCC4]/60">Ainda não há mensagens nesta mesa.</p>}
              </div>
            </div> : mobilePanel === 'dice' ? <div className="w-full max-w-3xl rounded-lg border border-[#A88956]/30 bg-[#191A1D]/90 p-4 shadow-xl">
              <h2 className="mb-3 font-semibold text-[#E3D8C6]">Histórico de rolagens</h2>
              <div className="space-y-2">
                {diceRolls.map(roll => <article key={roll.id} className="flex items-center justify-between rounded border border-[#A88956]/20 bg-[#101113]/80 p-3">
                  <div><p className="text-sm font-semibold text-[#E3D8C6]">{roll.user} · {roll.expression}</p><time className="text-[10px] text-[#D0CCC4]/50">{roll.time}</time></div>
                  <strong className="rounded border border-[#A88956]/40 bg-[#542126]/60 px-3 py-1 font-mono text-[#A88956]">{roll.total}</strong>
                </article>)}
                {diceRolls.length === 0 && <p className="text-sm text-[#D0CCC4]/60">Ainda não há rolagens nesta mesa.</p>}
              </div>
            </div> : selectedLibraryItem ? <div className="w-full max-w-[760px] rounded-lg border-2 border-[#A88956]/50 bg-[#191A1D]/90 p-2 shadow-2xl backdrop-blur sm:p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-1 px-1 sm:px-2">
                <div className="text-sm font-semibold text-[#A88956] flex items-center space-x-2">
                  <Compass className="w-4 h-4" />
                  <span>{selectedLibraryItem.name}</span>
                </div>
                <div className="text-xs text-[#D0CCC4]/60 font-mono">Grade {gridWidth} × {gridHeight}</div>
              </div>

              <div className="relative w-full overflow-auto rounded border border-[#A88956]/30" style={{ backgroundImage: selectedLibraryItem.data.backgroundUrl ? `url("${selectedLibraryItem.data.backgroundUrl}")` : undefined, backgroundSize: '100% 100%' }}>
                <div className="grid min-w-[320px] gap-px bg-[#A88956]/35 p-px" style={{ gridTemplateColumns: `repeat(${gridWidth}, minmax(0, 1fr))`, aspectRatio: `${gridWidth} / ${gridHeight}` }}>
                  {Array.from({ length: gridWidth * gridHeight }).map((_, idx) => <div key={idx} className="min-w-0 bg-[#101113]/10" aria-hidden="true" />)}
                </div>
              </div>
              <p className="mt-2 text-[10px] text-[#D0CCC4]/50">Visualização do mapa. Tokens e movimento sincronizado ainda não estão implementados.</p>
            </div> : <div className="max-w-md rounded-lg border border-[#A88956]/25 bg-[#191A1D]/90 p-6 text-center shadow-xl">
              <Compass className="mx-auto h-8 w-8 text-[#A88956]" aria-hidden="true" />
              <h2 className="mt-3 text-lg font-semibold text-[#E3D8C6]">{activeRoom?.name || 'Mesa'}</h2>
              <p className="mt-2 text-sm text-[#D0CCC4]/70">Nenhum mapa aberto. Selecione um mapa na biblioteca{activeRoom?.role === 'gm' ? ' ou crie uma pasta/mapa pelo painel à esquerda' : ''}.</p>
            </div>}
          </div>
        </main>

        {/* Right Sidebar: Chat, Dice & Logs */}
        <section className="hidden">
          <div className="flex border-b border-[#A88956]/20 bg-[#292A2E]">
            <button 
              onClick={() => { setActiveTab('chat'); setMobilePanel('chat'); }}
              className={`flex-1 py-3 text-xs font-semibold uppercase tracking-wider flex items-center justify-center space-x-1.5 transition ${activeTab === 'chat' ? 'bg-[#542126] text-[#E3D8C6] border-b-2 border-[#A88956]' : 'text-[#D0CCC4]/60 hover:text-[#D0CCC4]'}`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Chat</span>
            </button>
            <button 
              onClick={() => { setActiveTab('dice'); setMobilePanel('dice'); }}
              disabled={activeRoom?.role === 'spectator'}
              className={`flex-1 py-3 text-xs font-semibold uppercase tracking-wider flex items-center justify-center space-x-1.5 transition disabled:cursor-not-allowed disabled:opacity-40 ${activeTab === 'dice' ? 'bg-[#542126] text-[#E3D8C6] border-b-2 border-[#A88956]' : 'text-[#D0CCC4]/60 hover:text-[#D0CCC4]'}`}
            >
              <Dices className="w-3.5 h-3.5" />
              <span>Dados</span>
            </button>
            <button
              onClick={() => { setActiveTab('members'); setMobilePanel('members'); }}
              className={`flex-1 py-3 text-xs font-semibold uppercase tracking-wider flex items-center justify-center space-x-1 transition ${activeTab === 'members' ? 'bg-[#542126] text-[#E3D8C6] border-b-2 border-[#A88956]' : 'text-[#D0CCC4]/60 hover:text-[#D0CCC4]'}`}
            >
              <Users className="h-3.5 w-3.5" />
              <span>Membros</span>
            </button>
          </div>

          {activeTab === 'chat' ? (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {messages.map(msg => (
                  <div key={msg.id} className="p-2.5 rounded bg-[#101113]/80 border border-[#A88956]/20 shadow-sm">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-bold text-[#A88956]">{msg.user}</span>
                      <span className="text-[#D0CCC4]/40 font-mono text-[10px]">{msg.time}</span>
                    </div>
                    <p className="text-xs text-[#D0CCC4]">{msg.text}</p>
                  </div>
                ))}
              </div>
              <form onSubmit={handleSendMessage} className="p-3 border-t border-[#A88956]/20 bg-[#191A1D] flex space-x-2">
                <input 
                  type="text" 
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  aria-label="Mensagem da sala"
                  maxLength={500}
                  placeholder="Escreva uma mensagem..."
                  className="min-w-0 flex-1 rounded border border-[#A88956]/40 bg-[#101113] px-3 py-2 text-xs text-[#D0CCC4] focus:border-[#A88956] focus:outline-none focus:ring-2 focus:ring-[#A88956]/30"
                />
                <button type="submit" aria-label="Enviar mensagem" className="flex min-h-10 min-w-10 items-center justify-center rounded border border-[#A88956]/50 bg-[#542126] px-3 text-[#A88956] transition hover:bg-[#722E34]">
                  <Send className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </form>
            </div>
          ) : activeTab === 'dice' ? (
            <div className="flex-1 flex flex-col overflow-hidden p-3 space-y-4">
              <div className="bg-[#101113] p-3 rounded border border-[#A88956]/30 space-y-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-[#A88956]">Rolar dados</div>
                <div className="flex space-x-2">
                  <input 
                    type="text" 
                    value={diceExpr} 
                    onChange={(e) => setDiceExpr(e.target.value)}
                    aria-label="Expressão de dados"
                    className="flex-1 bg-[#191A1D] border border-[#A88956]/40 rounded px-2 py-1.5 text-xs font-mono text-[#D0CCC4]"
                    placeholder="1d20"
                  />
                  <button 
                    type="button"
                    onClick={() => handleRollDice(diceExpr)}
                    className="min-h-10 rounded border border-[#A88956]/60 bg-[#542126] px-4 py-1.5 text-xs font-bold text-[#E3D8C6] shadow transition hover:bg-[#722E34]"
                  >
                    Rolar
                  </button>
                </div>
                <div className="grid grid-cols-4 gap-1.5 pt-1">
                  {['1d20', '1d6', '1d8', '2d6'].map(expr => (
                    <button
                      type="button"
                      key={expr}
                      onClick={() => handleRollDice(expr)}
                      className="py-1 bg-[#202124] hover:bg-[#542126]/60 border border-[#A88956]/30 rounded text-[11px] font-mono text-[#A88956] transition"
                    >
                      {expr}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-1 flex-col overflow-hidden">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#A88956]">Histórico da sala</div>
                <div className="flex-1 space-y-2 overflow-y-auto pr-1">
                  {diceRolls.map(roll => (
                    <div key={roll.id} className="flex items-center justify-between rounded border border-[#A88956]/20 bg-[#101113]/80 p-2.5">
                      <div>
                        <div className="text-xs font-bold text-[#E3D8C6]">{roll.user} <span className="font-normal text-[#D0CCC4]/60">({roll.expression})</span></div>
                        <div className="text-[10px] text-[#D0CCC4]/50">{roll.time}</div>
                      </div>
                      <div className="rounded border border-[#A88956]/40 bg-[#542126]/60 px-2.5 py-1 text-xs font-mono font-bold text-[#A88956]">{roll.total}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 space-y-3 overflow-y-auto p-3">
              <p className="text-xs text-[#D0CCC4]/60">Membros cadastrados nesta sala; presença em tempo real ainda não é exibida.</p>
              {roomMembers.map(member => (
                <article key={member.id} className="rounded border border-[#A88956]/20 bg-[#101113]/80 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-[#E3D8C6]">{member.username}</span>
                    <span className="shrink-0 rounded border border-[#A88956]/30 px-2 py-1 text-[10px] uppercase text-[#A88956]">{member.role === 'gm' ? 'Mestre' : member.role === 'player' ? 'Jogador' : 'Espectador'}</span>
                  </div>
                  {member.mutedUntil && member.mutedUntil > new Date().toISOString() && <p className="mt-2 text-xs text-amber-200">Silenciado até {new Date(member.mutedUntil).toLocaleTimeString()}.</p>}
                  {activeRoom?.role === 'gm' && member.role !== 'gm' && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <label className="flex items-center gap-2 text-xs text-[#D0CCC4]/70">Papel
                        <select value={member.role} onChange={event => void handleSetMemberRole(member, event.target.value as 'player' | 'spectator')} className="min-h-9 rounded border border-[#A88956]/30 bg-[#101113] px-2 text-[#E3D8C6]">
                          <option value="player">Jogador</option>
                          <option value="spectator">Espectador</option>
                        </select>
                      </label>
                      {member.mutedUntil ? (
                        <button type="button" onClick={() => handleModeration(member, 'unmute')} className="min-h-9 rounded border border-[#A88956]/30 px-2 text-xs text-[#D0CCC4]">Remover silêncio</button>
                      ) : (
                        <button type="button" onClick={() => handleModeration(member, 'mute')} className="min-h-9 rounded border border-[#A88956]/30 px-2 text-xs text-[#D0CCC4]">Silenciar 10 min</button>
                      )}
                      <button type="button" onClick={() => handleModeration(member, 'kick')} className="min-h-9 rounded border border-red-800/60 px-2 text-xs text-red-200">Remover</button>
                      <button type="button" onClick={() => handleModeration(member, 'ban')} className="min-h-9 rounded border border-red-800/60 px-2 text-xs text-red-200">Banir</button>
                    </div>
                  )}
                </article>
              ))}
              {roomMembers.length === 0 && <p className="rounded border border-[#A88956]/20 p-3 text-xs text-[#D0CCC4]/60">Lista de membros vazia.</p>}
              {activeRoom?.role === 'gm' && bannedMembers.length > 0 && (
                <section className="mt-6 border-t border-[#A88956]/20 pt-4">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-red-200">Banidos</h3>
                  {bannedMembers.map(member => (
                    <div key={member.id} className="mb-2 flex items-center justify-between gap-2 rounded border border-red-900/50 p-2">
                      <span className="truncate text-xs">{member.username}</span>
                      <button type="button" onClick={() => handleModeration(member, 'unban')} className="min-h-9 rounded border border-[#A88956]/30 px-2 text-xs text-[#A88956]">Desbanir</button>
                    </div>
                  ))}
                </section>
              )}
            </div>
          )}
        </section>
        <section className={`${mobilePanel === 'members' ? 'flex' : 'hidden'} min-w-0 w-full shrink-0 flex-col bg-[#202124] md:flex md:w-72 md:border-l md:border-[#A88956]/20`}>
          <div className="border-b border-[#A88956]/20 bg-[#292A2E] p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-[#A88956]"><Users className="h-4 w-4" aria-hidden="true" />Participantes</h2>
            <p className="mt-1 text-[10px] text-[#D0CCC4]/50">Membros cadastrados; presença online não é exibida.</p>
          </div>
          <div className="flex-1 space-y-4 overflow-y-auto p-3">
            {(['gm', 'player', 'spectator'] as const).map(role => {
              const roleMembers = roomMembers.filter(member => member.role === role);
              if (roleMembers.length === 0) return null;
              const title = role === 'gm' ? 'Mestre' : role === 'player' ? 'Jogadores' : 'Espectadores';
              return <section key={role} aria-label={title}>
                <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[#A88956]/80">{title} · {roleMembers.length}</h3>
                <div className="space-y-2">
                  {roleMembers.map(member => <article key={member.id} className="rounded border border-[#A88956]/20 bg-[#101113]/80 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-[#E3D8C6]">{member.username}</span>
                      <span className="shrink-0 rounded border border-[#A88956]/30 px-2 py-1 text-[10px] uppercase text-[#A88956]">{role === 'gm' ? 'Mestre' : role === 'player' ? 'Jogador' : 'Espectador'}</span>
                    </div>
                    {member.mutedUntil && member.mutedUntil > new Date().toISOString() && <p className="mt-2 text-xs text-amber-200">Silenciado até {new Date(member.mutedUntil).toLocaleTimeString()}.</p>}
                    {activeRoom?.role === 'gm' && role !== 'gm' && <div className="mt-3 space-y-2">
                      <label className="flex items-center justify-between gap-2 text-xs text-[#D0CCC4]/70">Papel
                        <select value={member.role} onChange={event => void handleSetMemberRole(member, event.target.value as 'player' | 'spectator')} className="min-h-9 rounded border border-[#A88956]/30 bg-[#101113] px-2 text-[#E3D8C6]">
                          <option value="player">Jogador</option>
                          <option value="spectator">Espectador</option>
                        </select>
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => handleModeration(member, member.mutedUntil ? 'unmute' : 'mute')} className="min-h-9 rounded border border-[#A88956]/30 px-2 text-xs text-[#D0CCC4]">{member.mutedUntil ? 'Remover silêncio' : 'Silenciar 10 min'}</button>
                        <button type="button" onClick={() => handleModeration(member, 'kick')} className="min-h-9 rounded border border-red-800/60 px-2 text-xs text-red-200">Remover</button>
                        <button type="button" onClick={() => handleModeration(member, 'ban')} className="min-h-9 rounded border border-red-800/60 px-2 text-xs text-red-200">Banir</button>
                      </div>
                    </div>}
                  </article>)}
                </div>
              </section>;
            })}
            {roomMembers.length === 0 && <p className="rounded border border-[#A88956]/20 p-3 text-xs text-[#D0CCC4]/60">A lista de membros está vazia.</p>}
            {activeRoom?.role === 'gm' && bannedMembers.length > 0 && <section className="border-t border-[#A88956]/20 pt-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-red-200">Banidos</h3>
              {bannedMembers.map(member => <div key={member.id} className="mb-2 flex items-center justify-between gap-2 rounded border border-red-900/50 p-2">
                <span className="truncate text-xs">{member.username}</span>
                <button type="button" onClick={() => handleModeration(member, 'unban')} className="min-h-9 rounded border border-[#A88956]/30 px-2 text-xs text-[#A88956]">Desbanir</button>
              </div>)}
            </section>}
          </div>
        </section>
      </div>
      <footer className="grid shrink-0 gap-2 border-t border-[#A88956]/30 bg-[#191A1D] p-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-3">
        <form onSubmit={handleSendMessage} className="flex min-w-0 gap-2">
          <input type="text" value={inputMessage} onChange={event => setInputMessage(event.target.value)} aria-label="Mensagem da sala" maxLength={500} placeholder="Escreva uma mensagem..." className="min-h-10 min-w-0 flex-1 rounded border border-[#A88956]/40 bg-[#101113] px-3 text-sm text-[#D0CCC4]" />
          <button type="submit" aria-label="Enviar mensagem" className="flex min-h-10 min-w-10 items-center justify-center rounded border border-[#A88956]/50 bg-[#542126] px-3 text-[#A88956] hover:bg-[#722E34]"><Send className="h-4 w-4" aria-hidden="true" /></button>
        </form>
        <div className="flex min-w-0 items-center gap-1">
          <input type="text" value={diceExpr} onChange={event => setDiceExpr(event.target.value)} aria-label="Expressão de dados" placeholder="1d20" className="min-h-10 min-w-0 flex-1 rounded border border-[#A88956]/40 bg-[#101113] px-2 font-mono text-xs sm:w-24 sm:flex-none" />
          <button type="button" disabled={activeRoom?.role === 'spectator'} onClick={() => handleRollDice(diceExpr)} className="min-h-10 rounded border border-[#A88956]/60 bg-[#542126] px-3 text-xs font-semibold text-[#E3D8C6] disabled:opacity-40">Rolar</button>
          <button type="button" disabled={activeRoom?.role === 'spectator'} onClick={() => handleRollDice('1d20')} aria-label="Rolar 1d20" className="min-h-10 rounded border border-[#A88956]/30 px-2 font-mono text-[10px] text-[#A88956] disabled:opacity-40">d20</button>
        </div>
      </footer>
      <nav aria-label="Painéis da sala" className="grid shrink-0 grid-cols-5 border-t border-[#A88956]/30 bg-[#191A1D] p-1">
        <button type="button" onClick={() => { setActivePage('room'); setMobilePanel('map'); }} aria-current={mobilePanel === 'map' ? 'page' : undefined} className={`flex min-h-11 flex-col items-center justify-center gap-1 rounded text-[10px] sm:text-xs ${mobilePanel === 'map' ? 'text-[#E3D8C6]' : 'text-[#D0CCC4]/60'}`}><Compass className="h-4 w-4" aria-hidden="true" />Jogo</button>
        <button type="button" onClick={() => { setActivePage('room'); setMobilePanel('library'); }} aria-current={mobilePanel === 'library' ? 'page' : undefined} className={`flex min-h-11 flex-col items-center justify-center gap-1 rounded text-[10px] sm:text-xs ${mobilePanel === 'library' ? 'text-[#E3D8C6]' : 'text-[#D0CCC4]/60'}`}><Users className="h-4 w-4" aria-hidden="true" />Biblioteca</button>
        <button type="button" onClick={() => { setActiveTab('chat'); setMobilePanel('chat'); }} aria-current={mobilePanel === 'chat' ? 'page' : undefined} className={`flex min-h-12 flex-col items-center justify-center gap-1 rounded text-xs ${mobilePanel === 'chat' ? 'text-[#E3D8C6]' : 'text-[#D0CCC4]/60'}`}><MessageSquare className="h-4 w-4" aria-hidden="true" />Chat</button>
        <button type="button" disabled={activeRoom?.role === 'spectator'} onClick={() => { setActiveTab('dice'); setMobilePanel('dice'); }} aria-current={mobilePanel === 'dice' ? 'page' : undefined} className={`flex min-h-12 flex-col items-center justify-center gap-1 rounded text-xs disabled:opacity-30 ${mobilePanel === 'dice' ? 'text-[#E3D8C6]' : 'text-[#D0CCC4]/60'}`}><Dices className="h-4 w-4" aria-hidden="true" />Dados</button>
        <button type="button" onClick={() => { setActiveTab('members'); setMobilePanel('members'); }} aria-current={mobilePanel === 'members' ? 'page' : undefined} className={`flex min-h-12 flex-col items-center justify-center gap-1 rounded text-xs ${mobilePanel === 'members' ? 'text-[#E3D8C6]' : 'text-[#D0CCC4]/60'}`}><Users className="h-4 w-4" aria-hidden="true" />Pessoas</button>
      </nav>
      </>
      )}
    </div>
  );
}
export default App;
