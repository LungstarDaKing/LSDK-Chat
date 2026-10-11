// The reactions people can choose from, grouped for the picker. The database keeps the same
// list (reaction_allowed() in update-v0.5.sql) and refuses anything else.
export const QUICK = ['❤️', '👍', '😂', '😮', '😢', '🙏']
export const CATEGORIES = [
  { id: 'smileys', icon: '😀', name: 'Smileys', list: ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '😉', '😊', '😇', '🥰', '😍', '😘', '😋', '😜', '🤪', '😎', '🥳', '😏', '🤔', '😳', '🥺', '😮', '😱', '😨', '😢', '😭', '😞', '😔', '😟', '😒', '😤', '😡', '🤯', '😴', '🤗'] },
  { id: 'gestures', icon: '👍', name: 'Gestures', list: ['👍', '👎', '👌', '✌️', '🤞', '🤟', '🤘', '👋', '👏', '🙌', '🫶', '🙏', '💪', '🤝', '🫡', '👀', '🧠'] },
  { id: 'hearts', icon: '❤️', name: 'Hearts', list: ['❤️', '💔', '💕', '💖', '💗', '💘', '💝', '💙', '💚', '💛', '🧡', '💜', '🖤', '🤍'] },
  { id: 'symbols', icon: '🔥', name: 'Symbols', list: ['🔥', '💯', '✨', '💥', '⚡', '⭐', '✅', '❌', '🎉'] },
  { id: 'nature', icon: '🌈', name: 'Nature & food', list: ['🐶', '🐱', '🦁', '🐼', '🦄', '🐢', '🦋', '🌹', '🌈', '☀️', '🌙', '🍀', '🍕', '🍔', '🍟', '🍩', '🍫', '☕', '🍻', '🎂'] },
  { id: 'things', icon: '🎮', name: 'Things', list: ['⚽', '🏆', '🎵', '🎧', '🎮', '📚', '💡', '🚀', '💰', '🎁'] },
]
