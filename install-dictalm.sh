#!/bin/bash
# Install DictaLM model in Ollama

# Create the model using Ollama API
curl -X POST http://ollama.callanalytics.local:11434/api/create \
  -H "Content-Type: application/json" \
  -d '{
    "name": "dictalm2.0-instruct:Q4_K_M",
    "modelfile": "FROM /root/.ollama/models/dictalm2.0-instruct.Q4_K_M.gguf\n\nTEMPLATE \"\"\"{{ if .System }}<|im_start|>system\n{{ .System }}<|im_end|>\n{{ end }}{{ if .Prompt }}<|im_start|>user\n{{ .Prompt }}<|im_end|>\n{{ end }}<|im_start|>assistant\n\"\"\"\n\nPARAMETER temperature 0.2\nPARAMETER top_k 15\nPARAMETER top_p 0.7\nPARAMETER repeat_penalty 1.15\nPARAMETER num_ctx 2048\nPARAMETER num_predict 150\nPARAMETER frequency_penalty 0.1\nPARAMETER presence_penalty 0.1\nPARAMETER num_gpu 99\n\nPARAMETER stop <|im_start|>\nPARAMETER stop <|im_end|>\n\nSYSTEM \"\"\"You are a call center data analyst. Analyze the provided data to answer questions directly.\n\nCORE INSTRUCTIONS:\n- Answer exactly what is asked based on the data provided\n- Hebrew questions → Hebrew responses (brief and direct)\n- English questions → English responses (brief and direct)\n- Use actual data from context, not generic responses\n- Be specific when data is available, clear when data is missing\n\nDATA ANALYSIS:\n- Analyze the provided data to answer questions directly\n- Use the most relevant data from the context for each question\n- Be precise with numbers and customer identifiers from the data\n\nRESPONSE STYLE:\n- Direct and factual\n- 1-2 sentences maximum\n- Focus on answering the specific question\n- Let the data guide your response\n\"\"\""
  }' \
  --connect-timeout 120

echo "DictaLM model installation completed"