# Bug Fix: Voz TTS inadequada pro contexto terror

**Data**: 2026-08-28
**Severidade**: MÉDIO (UX)
**Sintoma**: Voz padrão MiniMax soava jovem/animada, quebrando imersão de "locutor de contos de terror na madrugada".

## Iterações

### Tentativa 1: `Portuguese_Narrator`
- Soa **feminina** (não encaixa com "Gugu" personagem masculino)
- Boa dicção mas inadequada pro tema
- ❌ Abandonado

### Tentativa 2: Edge TTS `pt-BR-AntonioNeural`
- Voz masculina mas **velocidade e pitch** padrão Microsoft = robótica
- Suavizou com `rate=-15%` + `pitch=-10Hz`
- ⚠️ Aceitável como fallback

### Tentativa 3 (final): `Portuguese_Deep-VoicedGentleman` ✅
- Voz masculina grave nativa MiniMax
- Soa como locutor noturno de rádio
- Validação E2E via Whisper reconheceu todas as palavras (sem alucinação fonética)
- **Escolhido como voz padrão**

## Configuração MiniMax

```javascript
{
  model: "speech-2.8-hd",
  voice_id: "Portuguese_Deep-VoicedGentleman",
  speed: 0.85,        // levemente mais lento pra soar solene
  pitch: -2,          // levemente mais grave
  sample_rate: 32000
}
```

## Validação E2E

```bash
# Gerar fala de teste
curl -X POST https://api.minimax.io/v1/text_to_speech \
  -H "Authorization: Bearer $MINIMAX_API_KEY" \
  -d '{
    "model": "speech-2.8-hd",
    "voice_id": "Portuguese_Deep-VoicedGentleman",
    "input": "Boa noite, querido ouvinte. Hoje o conto é O Barril de Amontillado."
  }'

# Validar via Whisper
whisper test.mp3 --language pt --model medium
# Esperado: texto idêntico ao input
```

## Lição aprendida

- Escolher voz **por contexto**, não por "default"
- Validar TTS com **Whisper** antes de botar em produção (detecta alucinação fonética)
- Manter `EDGE_TTS_VOICE` como fallback em `.env.example`
