import csv
import json

csv_file_path = 'C:\Users\Usuario\Desktop\detectron2-windows-master\asoferru-chatbot\products_backup.csv'
json_file_path = 'C:\Users\Usuario\Desktop\asoferru-chatbot-clean\data\products_filtered.json'

products = []
with open(csv_file_path, 'r', encoding='utf-8') as csv_file:
    csv_reader = csv.DictReader(csv_file, delimiter=';')
    for row in csv_reader:
        products.append(row)

with open(json_file_path, 'w', encoding='utf-8') as json_file:
    json.dump(products, json_file, indent=2, ensure_ascii=False)

print(f'Successfully converted {csv_file_path} to {json_file_path}')
